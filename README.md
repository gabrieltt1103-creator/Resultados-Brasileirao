# Rodada ao Vivo · Brasileirão

Micro app para acompanhar no celular a rodada do Brasileirão Série A em tempo real.

- Placar ao vivo com minuto do jogo, intervalo, encerrados, adiados e horário dos próximos.
- Autores dos gols (com pênalti e gol contra) e cartões vermelhos.
- Destaque amarelo de **GOL** (e vibração no Android) quando o placar muda.
- Setas para ver a rodada anterior e a próxima; o número da rodada é calculado pela classificação.
- Aba **Tabela** com a classificação e as zonas (Libertadores, Sul-Americana, rebaixamento).
- Atualiza sozinho a cada 30 s durante os jogos e a cada 2 min fora deles. Pausa quando o app sai da tela, para poupar bateria e dados.
- Tema claro e escuro conforme o celular.

Os dados vêm da API pública da ESPN (`site.api.espn.com`), chamada direto do navegador, sem servidor e sem chave de API.

## Como abrir no celular

O app é só HTML, CSS e JS estáticos, então o GitHub Pages hospeda de graça:

1. No GitHub, abra **Settings → Pages** deste repositório.
2. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
3. Selecione o branch (`main`, ou o branch onde o app está) e a pasta **/ (root)**. Clique em **Save**.
4. Em cerca de 1 minuto o app fica em
   `https://gabrieltt1103-creator.github.io/Resultados-Brasileirao/`

Para usar como app: abra o link no celular e escolha **Adicionar à tela inicial**
(no Chrome do Android fica no menu ⋮; no Safari do iPhone, no botão de compartilhar).

## Rodar localmente

```sh
npx http-server -p 8080
# abra http://localhost:8080
```

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `index.html` | Estrutura da página |
| `style.css` | Visual (mobile first, tema claro e escuro) |
| `app.js` | Busca na ESPN, agrupa as rodadas, detecta gols e desenha a tela |
| `manifest.webmanifest`, `icons/` | Ícone e modo app na tela inicial |

A API da ESPN não é oficial e pode mudar de formato sem aviso. Se o app parar de mostrar os jogos, o ponto a ajustar é `parseEvent` em `app.js`.
