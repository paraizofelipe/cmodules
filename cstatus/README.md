# cstatus

Status line para o Claude Code com o modelo ativo e o uso dos limites da
assinatura, logo abaixo do prompt e acima da linha do modo de permissão:

```
❯
────────────────────────────────────────────────────
  [Opus 5.5]  5h ████░░░░░░ 42%  week █░░░░░░░░░ 12%
  ⏵⏵ auto mode on (shift+tab to cycle)
```

- **Modelo**: o do loop principal, como o `/model` mostra.
- **5h**: uso da janela de 5 horas.
- **week**: uso da janela de 7 dias.
- Barra e % coloridas: verde, amarelo a partir de 70%, vermelho a partir de 90%.

## Como funciona

A API de mods não desenha nessa posição; ela é da `statusLine` nativa do Claude
Code, e o `settings.json` de um plugin não consegue defini-la. Por isso o mod
instala `statusline/statusline.mjs` (Node puro, sem dependências) como a
`statusLine` do seu `~/.claude/settings.json`:

| Comando | O que faz |
| --- | --- |
| `/cstatus` | Copia o script para `~/.claude/cstatus/statusline.mjs`, faz backup do settings.json em `settings.json.cstatus.bak` e grava a `statusLine`. Recusa se já houver outra status line ou se o arquivo não for JSON válido. |
| `/cstatus off` | Remove a `statusLine`, só se ela for a do cstatus. |

A cada sessão, o mod atualiza a cópia do script e o caminho do `node` (nvm, mise)
de uma instalação já feita. Ele nunca instala sozinho nem toca na status line de
outro programa.

## Atualização

O Claude Code roda o script a cada resposta do modelo, depois de `/compact`, na
troca do modo de permissão e quando uma janela chega ao horário de reset (que
zera a barra).

Os limites só existem em planos de assinatura (Pro/Max) e aparecem após a
primeira resposta da sessão; até lá, ou com API key, a barra fica vazia com `--%`.

## Instalação

```sh
claude plugin marketplace add paraizofelipe/cmodules
claude plugin install cstatus@cmodules
```

Depois, dentro de uma sessão:

```
/cstatus
```

## Desenvolvimento

```sh
claude --plugin-dir ~/projects/cmodules/cstatus   # recarrega a cada turno
claude plugin validate .
claude plugin test .                               # o mod (instalação)
node --test statusline/statusline.test.mjs         # o desenho da linha
```

O plugin instalado é uma cópia: ao publicar mudanças, aumente o `version` em
`.claude-plugin/plugin.json` antes do push.
