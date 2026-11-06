# csidebar

Mod para o Claude Code que abre uma sidebar com o uso do contexto. Os limites
da assinatura (5h e semana) ficam no [cstatus](../cstatus).

- **Contexto**: tokens usados sobre a janela, a barra com a % à direita, e onde o
  auto-compact dispara. A cor segue a distância até o auto-compact: verde
  longe dele, amarela nos últimos 20% do caminho e vermelha quando ele já vai
  rodar. Com o auto-compact desligado, a medida é a própria janela.
- **Contexto por categoria**: uma tabela com uma linha por categoria do
  `/context` (System prompt, System tools, MCP, Skills, Messages…), em 3
  colunas: categoria, tokens e fatia da janela. Só o ícone leva a cor da
  categoria; a única barra é a do total. Abaixo, os tokens de cada servidor MCP
  carregado:

  ```
  Categoria          Tokens      %
  ⛁ System prompt      2,9k   0,3%
  ⛁ Messages          78,3k   7,8%
  ⛶ Free space       885,8k  88,6%
  ```

- **MCP ativos**: os servidores MCP com tools na sessão e o total de tools de
  cada um (carregadas ou adiadas), do que tem mais tools para o que tem menos.
  Servidores que falharam ao conectar não aparecem: a API de mods só vê os que
  têm tools.
- **Sessões**: as 8 sessões mais recentes do projeto, com título (o do
  `/rename` vence o automático) e idade. A atual vem marcada com `▸`; clicar
  em outra, ou apertar o dígito dela com a sidebar em foco (`ctrl+x` `tab`),
  roda `/resume` nela. Lê os transcripts da conta ativa (`CLAUDE_CONFIG_DIR`,
  ou `~/.claude`) e precisa do `grep` no PATH.

  ```
  SESSÕES
  ▸  Tabela no csidebar         agora
  1: Fix pipeline do hector     há 2h
  2: Revisão GMUD 4512          há 3d
  ```

## Atualização

- A cada resposta do modelo, o contexto é recontado por estimativa local (sem custo).
- Ociosa (1 min sem turno), a cada 5 min o contexto é recontado com o
  token-count API, como o `/context` faz.
- Depois de um `/resume`, `/clear` ou `/compact` (manual ou automático), o contexto é recontado por completo em
  segundos (o cabeçalho mostra "atualizando…" enquanto isso).
- O cabeçalho mostra há quanto tempo os números foram atualizados.

## Instalação

```sh
claude plugin marketplace add paraizofelipe/cmodules
claude plugin install csidebar@cmodules
```

Ou, dentro de uma sessão:

```
/plugin install csidebar --marketplace paraizofelipe/cmodules
```

Para atualizar: `claude plugin marketplace update cmodules`.

## Uso

A sidebar (46 colunas) abre sozinha em terminais largos (≥ 144 colunas) e fica ancorada ao
lado do transcript no layout fullscreen. Em qualquer largura, `/csidebar` abre
a sidebar.

## Desenvolvimento

```sh
claude --plugin-dir ~/projects/cmodules/csidebar   # recarrega a cada turno
claude plugin validate .
claude plugin test .
```

O plugin instalado é uma cópia: ao publicar mudanças, aumente o `version` em
`.claude-plugin/plugin.json` antes do push.
