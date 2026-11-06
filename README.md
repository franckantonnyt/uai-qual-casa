# Uai, Qual Casa?

Página única com **lista + mapa fixo**, **nome salvo no navegador**, e opinião **só dentro da casa** (modal): botões **Curti** e **Não curti**. No **admin** (`?admin=...`): ranking por curtidas e controle da votação.

Use um **projeto Supabase dedicado** ao rodar o SQL.

## Rápido

1. Copie `js/config.example.js` para `js/config.js` e preencha URL e chave pública.
   - **Distância até o ponto da família:** no mapa, toque em **Marcar ponto da família** e escolha o lugar. O pin pode ser arrastado, e os botões **Mudar o ponto** e **Remover** ficam no mapa. A distância nas fichas é por **rota de carro** (OpenStreetMap/OSRM, serviço público). Fica gravado no **navegador** (`localStorage`), então cada aparelho marca o seu.
2. Rode o **SQL** abaixo no Supabase (tabela `votos` com `gostei`, `device_id`, etc.).
3. Deploy da Edge Function `admin` e secret `ADMIN_KEY`.
4. Edite `casas.json` e publique o site estático. Cada casa pode ter `local` (ex.: `"Guarapari, ES"`) e `quartos` (número): são eles que aparecem no cartão da lista.

### Formato da URL de admin

Com o site aberto na mesma pasta onde está o `index.html`, acrescente na barra de endereço:

`?admin=SEU_SEGREDO`

Use **o mesmo valor** do secret `ADMIN_KEY` da Edge Function. Ele não fica em nenhum arquivo do site, porque tudo em `js/` pode ser lido por quem abre a página. Exemplo ilustrativo:

`https://seu-dominio.com.br/?admin=COLE_UM_SEGREDO_LONGO`

Aí aparece o painel do organizador, com o link **Ver o site** (abre a página da família em outra aba) e três botões: **Pausar/Abrir votação**, **Mostrar/Esconder resultados** e **Limpar todos os votos**. O **SQL do Supabase não muda** por causa do admin: ele já está documentado abaixo; só precisa ter rodado o script no projeto certo e feito o deploy da função com o `ADMIN_KEY`.

### Descrição das casas (`casas.json`)

O campo `descricao` pode usar **negrito** com `**texto**` e listas com linhas que começam por `- `; o site converte para HTML legível no card e no modal.

## Comportamento

- **Primeira visita:** modal pede o nome → grava em `localStorage` (sobrevive fechar o navegador no mesmo aparelho). No canto superior direito: nome + **Sair** (limpa e pede de novo).
- **Lista:** scroll só na coluna da esquerda; **mapa** à direita fica fixo (no celular o mapa abre em tela cheia pelo botão **Ver no mapa**).
- **Curtir / Não curti:** só no modal **Abrir fotos** (lista ou mapa abre o mesmo modal).
- **Ranking:** curtidas = linhas com `gostei = true`. **Um registro por aparelho em cada casa** (`device_id` + `casa_id` únicos): a pessoa opina em quantas casas quiser e pode mudar de ideia em cada uma.

## Supabase: SQL

Projeto **novo**: rode o bloco completo. Projeto **já no ar**: rode só o bloco "Migração: várias casas por aparelho", antes de publicar o site.

```sql
-- Tabela de opiniões (uma linha por aparelho em cada casa)
create table if not exists votos (
  id uuid primary key default gen_random_uuid(),
  device_id text not null,
  nome_norm text not null,
  nome_display text,
  casa_id text not null,
  gostei boolean not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists votos_device_casa_key on votos (device_id, casa_id);

-- Migração a partir do schema antigo (nome único global):
-- drop index if exists votos_nome_norm_unique;
-- alter table votos add column if not exists device_id text;
-- alter table votos add column if not exists nome_display text;
-- alter table votos add column if not exists gostei boolean;
-- update votos set gostei = true where gostei is null;
-- alter table votos alter column gostei set not null;
-- create unique index if not exists votos_device_casa_key on votos (device_id, casa_id);

create table if not exists config (
  key text primary key,
  value text not null
);

insert into config (key, value) values ('voting_closed', 'false')
on conflict (key) do nothing;
insert into config (key, value) values ('show_results', 'false')
on conflict (key) do nothing;

alter table votos enable row level security;
alter table config enable row level security;

drop policy if exists "inserir voto se aberto" on votos;
drop policy if exists "atualizar voto se aberto" on votos;
drop policy if exists "ler votos quando resultados liberados" on votos;

create policy "inserir opiniao se aberto"
on votos for insert
with check (
  coalesce((select value from config where key = 'voting_closed'), 'false') = 'false'
);

create policy "atualizar opiniao se aberto"
on votos for update
using (
  coalesce((select value from config where key = 'voting_closed'), 'false') = 'false'
)
with check (
  coalesce((select value from config where key = 'voting_closed'), 'false') = 'false'
);

create policy "ler votos curtidas quando resultados liberados"
on votos for select
using (
  coalesce((select value from config where key = 'show_results'), 'false') = 'true'
);

create policy "config leitura publica"
on config for select
using (true);

create policy "config sem escrita anon"
on config for insert with check (false);
create policy "config sem update anon"
on config for update using (false);
create policy "config sem delete anon"
on config for delete using (false);

-- Grava a opinião. Roda com os direitos do dono da função: um upsert direto do navegador
-- esbarra na política de leitura enquanto os resultados estão ocultos.
create or replace function registrar_opiniao(
  p_device_id text,
  p_nome_norm text,
  p_nome_display text,
  p_casa_id text,
  p_gostei boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select value from config where key = 'voting_closed'), 'false') <> 'false' then
    raise exception 'voting_closed';
  end if;

  insert into votos (device_id, nome_norm, nome_display, casa_id, gostei)
  values (p_device_id, p_nome_norm, p_nome_display, p_casa_id, p_gostei)
  on conflict (device_id, casa_id) do update
    set nome_norm = excluded.nome_norm,
        nome_display = excluded.nome_display,
        gostei = excluded.gostei,
        updated_at = now();
end;
$$;

revoke all on function registrar_opiniao(text, text, text, text, boolean) from public;
grant execute on function registrar_opiniao(text, text, text, text, boolean) to anon, authenticated;
```

### Migração: várias casas por aparelho

Pra projeto que já está no ar. Os votos existentes continuam valendo.

```sql
drop index if exists votos_device_id_key;
create unique index if not exists votos_device_casa_key on votos (device_id, casa_id);

create or replace function registrar_opiniao(
  p_device_id text,
  p_nome_norm text,
  p_nome_display text,
  p_casa_id text,
  p_gostei boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select value from config where key = 'voting_closed'), 'false') <> 'false' then
    raise exception 'voting_closed';
  end if;

  insert into votos (device_id, nome_norm, nome_display, casa_id, gostei)
  values (p_device_id, p_nome_norm, p_nome_display, p_casa_id, p_gostei)
  on conflict (device_id, casa_id) do update
    set nome_norm = excluded.nome_norm,
        nome_display = excluded.nome_display,
        gostei = excluded.gostei,
        updated_at = now();
end;
$$;

revoke all on function registrar_opiniao(text, text, text, text, boolean) from public;
grant execute on function registrar_opiniao(text, text, text, text, boolean) to anon, authenticated;
```

## Edge Function `admin`

```bash
supabase secrets set ADMIN_KEY="SEU_SEGREDO_LONGO"
supabase functions deploy admin --no-verify-jwt
```

Com **Mostrar resultados** ligado, cada aparelho vê um botão no meio da tela. Ao tocar nele, solta confete e mostra a casa mais curtida e o ranking. Em caso de empate, todas as casas empatadas aparecem.

Depois de mudar `supabase/functions/admin/index.ts`, publique a função de novo: **Limpar todos os votos** depende da ação `clear-votes`.

## Licença

Uso familiar, ajuste à vontade.
