# cstatus

Mod para o Claude Code que mostra, numa linha logo abaixo do prompt, o modelo
ativo e o uso dos limites da assinatura:

```
[Opus 5.5]  5h ████░░░░░░ 42%  week █░░░░░░░░░ 12%
```

- **Modelo**: o do loop principal, como o `/model` mostra.
- **5h**: uso da janela de 5 horas.
- **week**: uso da janela de 7 dias.
- Barra e % coloridas: verde, amarelo a partir de 70%, vermelho a partir de 90%.

A linha fica entre o prompt e a linha de dicas do Claude Code, que continua
inteira logo abaixo (modo de permissão, `esc to interrupt`, atalhos).

## Atualização

- A cada resposta do modelo (inclui a troca pelo `/model`, que aparece no turno seguinte).
- Quando a API informa uma mudança nos limites.
- A cada 1 min, para zerar a janela cujo horário de reset já passou.

Os limites só existem em planos de assinatura (Pro/Max) e aparecem após a
primeira resposta; até lá, ou com API key, a barra fica vazia com `--%`.

## Instalação

```sh
claude plugin marketplace add paraizofelipe/cmodules
claude plugin install cstatus@cmodules
```

Ou, dentro de uma sessão:

```
/plugin install cstatus --marketplace paraizofelipe/cmodules
```

## Desenvolvimento

```sh
claude --plugin-dir ~/projects/cmodules/cstatus   # recarrega a cada turno
claude plugin validate .
claude plugin test .
```

O plugin instalado é uma cópia: ao publicar mudanças, aumente o `version` em
`.claude-plugin/plugin.json` antes do push.
