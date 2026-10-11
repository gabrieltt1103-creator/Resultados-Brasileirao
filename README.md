# Rodada ao Vivo · Brasileirão

Micro app para acompanhar no celular a rodada do Brasileirão Série A em tempo real e entender o que ela muda no campeonato.

## O que tem

**Jogos**
- Placar ao vivo com minuto, intervalo, encerrados, adiados e horário dos próximos.
- Autores dos gols (pênalti e gol contra), cartões vermelhos e a posição de cada time na tabela, com seta de quem subiu ou caiu na rodada.
- **Resumo da rodada** escrito automaticamente: troca de liderança, quem entra ou sai do G6 e do Z4, viradas, zebras, gols no fim, hat-tricks e goleadas. Antes da bola rolar vira uma prévia com o jogão e a briga contra a queda.
- Aviso de **GOL** no topo da tela, placar piscando em amarelo, vibração no Android e som de torcida opcional (ícone de alto-falante).
- Botão para compartilhar os placares da rodada no WhatsApp ou onde quiser.

**Detalhe do jogo** (toque no cartão)
- Lance a lance com gols e cartões, estatísticas (posse, finalizações, chutes no gol, escanteios, faltas…) e os últimos 5 jogos de cada time.
- **O que está em jogo**: em que posição cada time fica se vencer, empatar ou perder, considerando os outros placares do momento.

**Tabela**
- Classificação **ao vivo**: como fica se os jogos terminarem agora, com o resultado parcial de cada time e setas de movimento.
- Pontos, jogos, V/E/D, saldo, gols pró e contra, aproveitamento e últimos 5 jogos. Nome e posição ficam fixos ao rolar para o lado.
- Zonas de Libertadores, Sul-Americana e rebaixamento.
- Toque num time para ver distância para o líder, para o G6 e para o Z4, o próximo jogo e os últimos resultados.

**Números**
- Gols da rodada, média por jogo, empates, cartões, quem venceu mais (mandante ou visitante), em que minutos saem os gols, artilheiros da rodada e maior goleada.
- Times em alta e em baixa nos últimos 5 jogos, melhor ataque e melhor defesa.

**Meu time e bolão**
- Escolha seu time: ele ganha destaque e um cartão no topo diz como ele está ("se terminar assim, sobe para 4º"). Gol dele solta confete.
- Bolão pessoal: palpite nos jogos que ainda não começaram. Placar exato vale 3 pontos e acertar o vencedor ou o empate vale 1. Fica salvo só no seu celular.

Atualiza sozinho a cada 30 s durante os jogos e a cada 2 min fora deles, e pausa quando o app sai da tela para poupar bateria e dados. Tema claro e escuro conforme o celular.

Os dados vêm da API pública da ESPN (`site.api.espn.com`), chamada direto do navegador, sem servidor e sem chave de API. A ESPN não informa o número da rodada nem a tabela ao vivo: o app calcula os dois a partir dos jogos e da classificação oficial.

## Como abrir no celular

O app é só HTML, CSS e JS estáticos, então o GitHub Pages hospeda de graça:

1. No GitHub, abra **Settings → Pages** deste repositório.
2. Em **Build and deployment → Source**, escolha **Deploy from a branch**.
3. Selecione o branch (`main`, ou o branch onde o app está) e a pasta **/ (root)**. Clique em **Save**.
4. Em cerca de 1 minuto o app fica em
   `https://gabrieltt1103-creator.github.io/Resultados-Brasileirao/`

Para usar como app: abra o link no celular e escolha **Adicionar à tela inicial**
(no Chrome do Android fica no menu ⋮; no Safari do iPhone, no botão de compartilhar).

## Desenvolvimento

```sh
npm start   # servidor local em http://localhost:8080
npm test    # testes da lógica (rodadas, tabela ao vivo, manchetes, números, bolão)
```

Não há build nem dependências: os módulos em `js/` rodam direto no navegador.

| Arquivo | O que faz |
| --- | --- |
| `index.html`, `style.css` | Estrutura e visual (mobile first, tema claro e escuro) |
| `js/espn.js` | Busca na ESPN e normaliza jogos, classificação e estatísticas |
| `js/rounds.js` | Agrupa os jogos em rodadas e descobre o número de cada uma |
| `js/table.js` | Tabela ao vivo, zonas, últimos 5 jogos, cenários e distâncias |
| `js/insights.js` | Histórias dos jogos, manchetes da rodada e números |
| `js/bolao.js` | Palpites e pontuação do bolão |
| `js/fx.js` | Som de gol, vibração e confete |
| `js/ui.js` | Monta o HTML de cada parte da tela |
| `js/app.js` | Estado, atualização automática e interações |
| `tests/` | Dados de exemplo no formato da ESPN e testes |

A API da ESPN não é oficial e pode mudar de formato sem aviso. Se o app parar de mostrar os jogos, o ponto a ajustar é `js/espn.js`.
