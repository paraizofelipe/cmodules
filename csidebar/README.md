# csidebar

Mod para o Claude Code que abre uma sidebar com o uso da assinatura e do contexto:

- **Limites**: janelas de 5 horas, 7 dias e a do Fable 5 (quando a API a informa).
  Cada uma tem barra, percentual, cor (verde, amarelo a partir de 70%, vermelho
  a partir de 90%) e quanto falta para resetar. Depois do horário de reset a
  barra zera sozinha.
- **Contexto**: tokens usados sobre a janela, com barra e %, e onde o
  auto-compact dispara.
- **Contexto por categoria**: a mesma grid do `/context`, com a legenda por
  categoria (System prompt, System tools, MCP, Skills, Messages…) e os tokens
  de cada servidor MCP carregado.

## Atualização

- A cada resposta do modelo, o contexto é recontado por estimativa local (sem custo).
- Ociosa (1 min sem turno), a cada 5 min o contexto é recontado com o
  token-count API, como o `/context` faz.
- Os percentuais dos limites só mudam quando chega uma resposta da API; ociosa,
  a sidebar atualiza a contagem até o reset e zera a janela que resetou.
- Depois de um `/resume`, `/clear` ou `/compact` (manual ou automático), o contexto é recontado por completo em
  segundos (o cabeçalho mostra "atualizando…" enquanto isso).
- O cabeçalho mostra há quanto tempo os números foram atualizados.

## Uso

```sh
claude --plugin-dir ~/projects/cmodules/csidebar
```

A sidebar (46 colunas) abre sozinha em terminais largos (≥ 144 colunas) e fica ancorada ao
lado do transcript no layout fullscreen. Em qualquer largura, `/csidebar` abre
a sidebar.

Os limites aparecem após a primeira resposta do modelo e só existem em planos
de assinatura (Pro/Max). Com API key a sidebar mostra "Sem dados" neles; o
contexto aparece de qualquer forma.

## Desenvolvimento

```sh
claude plugin validate .
claude plugin test .
```
