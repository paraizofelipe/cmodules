# csidebar

Mod para o Claude Code que abre uma sidebar com o uso do contexto. Os limites
da assinatura (5h e semana) ficam no [cstatus](../cstatus).

- **Contexto**: tokens usados sobre a janela, com barra e %, e onde o
  auto-compact dispara.
- **Contexto por categoria**: a mesma grid do `/context`, com a legenda por
  categoria (System prompt, System tools, MCP, Skills, Messages…) e os tokens
  de cada servidor MCP carregado.

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
