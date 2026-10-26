# cmodules

Módulos (mods) para o Claude Code. O repositório é um marketplace de plugins.

| Módulo | Descrição |
| --- | --- |
| [csidebar](csidebar) | Sidebar com o uso dos limites (5h, semana, Fable 5) e do contexto |
| [cstatus](cstatus) | Linha abaixo do prompt com o modelo ativo e o uso dos limites de 5h e semanal |

## Instalação

```sh
claude plugin marketplace add paraizofelipe/cmodules
claude plugin install csidebar@cmodules
claude plugin install cstatus@cmodules
```

Para atualizar depois de uma nova versão:

```sh
claude plugin marketplace update cmodules
```
