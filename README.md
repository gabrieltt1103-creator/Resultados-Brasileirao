# Rodada ao Vivo · Brasileirão

Micro app para acompanhar no celular a rodada do Brasileirão Série A em tempo real e entender o que ela muda no campeonato.

## O que tem

**Jogos**
- A rodada completa, com os 10 jogos: inclusive os adiados, os remarcados para outro dia e os antecipados.
- Placar ao vivo com minuto, intervalo, encerrados, adiados e horário dos próximos. Jogos de outras rodadas que acontecem hoje aparecem no topo.
- Autores dos gols (pênalti e gol contra), cartões vermelhos e a posição de cada time na tabela, com seta de quem subiu ou caiu na rodada.
- **Resumo da rodada** escrito automaticamente: troca de liderança, quem entra ou sai do G6 e do Z4, viradas, zebras, gols no fim, hat-tricks e goleadas. Antes da bola rolar vira uma prévia com o jogão e a briga contra a queda.
- Aviso de **GOL** no topo da tela, placar piscando em amarelo, vibração no Android e som de torcida opcional (ícone de alto-falante).
- Botão para compartilhar os placares da rodada no WhatsApp ou onde quiser.

**Detalhe do jogo** (toque no cartão)
- Lance a lance com gols e cartões, estatísticas (posse, finalizações, chutes no gol, escanteios, faltas…) e os últimos 5 jogos de cada time.
- **O que está em jogo**: em que posição cada time fica se vencer, empatar ou perder, considerando os outros placares do momento.

**Tabela**
- Classificação **ao vivo**: como fica se os jogos terminarem agora, com o resultado parcial de cada time e setas de movimento. Calculada a partir de todos os jogos da temporada; se faltarem jogos, usa a classificação oficial da ESPN corrigida com a rodada.
- Pontos, jogos, V/E/D, saldo, gols pró e contra, aproveitamento e últimos 5 jogos. Nome e posição ficam fixos ao rolar para o lado.
- Zonas de Libertadores, Sul-Americana e rebaixamento.
- Toque num time para ver distância para o líder, para o G6 e para o Z4, os próximos 5 jogos (com rodada e posição de cada adversário) e os últimos resultados.

**Simular**
- Escolha placares para os jogos que faltam (com + e −, ou nos botões de vitória e empate) e veja a tabela mudar na hora, com quem sobe, quem cai e quem entra ou sai do G6 e do Z4.
- **Chances até o fim**: título, G6 e Z4 para cada time, em 3.000 simulações do restante do campeonato com base nos gols marcados e sofridos e na vantagem de jogar em casa. As chances mudam com os placares que você escolher.
- "Sortear placares" preenche a rodada com resultados prováveis. Dá para simular várias rodadas: tudo o que foi simulado entra na conta.

**Números**
- Gols da rodada, média por jogo, empates, cartões, quem venceu mais (mandante ou visitante), em que minutos saem os gols, artilheiros da rodada e maior goleada.
- Times em alta e em baixa nos últimos 5 jogos, melhor ataque e melhor defesa.

**Meu time**
- Escolha seu time: ele ganha destaque e um cartão no topo diz como ele está ("se terminar assim, sobe para 4º"). Gol dele solta confete. No detalhe do time aparecem as chances dele até o fim.

**Status dos dados**
- No rodapé, mostra o que carregou e o que falhou (jogos da temporada, classificação, estatísticas). Se alguma parte não aparecer, um print dessa tela diz o motivo.

Atualiza sozinho a cada 30 s durante os jogos e a cada 2 min fora deles, e pausa quando o app sai da tela para poupar bateria e dados. Tema claro e escuro conforme o celular.

Os dados vêm da API pública da ESPN (`site.api.espn.com`), chamada direto do navegador, sem servidor e sem chave de API. Ao abrir, o app busca a temporada inteira numa chamada (`dates=2026`) e guarda no celular para abrir mais rápido da próxima vez; depois só atualiza, dia a dia, os jogos de ontem, hoje e amanhã. A ESPN aceita no parâmetro `dates` um ano, um mês (`202610`) ou um dia (`20261011`), mas recusa intervalos (`20261001-20261031`) no Brasileirão.

A ESPN não informa a rodada de cada jogo. O app usa o fato de que, no Brasileirão, a rodada r+19 repete a rodada r com o mando invertido: os dois jogos de cada confronto ficam no mesmo par de rodadas, então um jogo adiado, antecipado ou de rodada dividida é colocado na rodada certa pelo outro jogo do confronto. Conferido contra as rodadas oficiais (Cartola FC) de 2026: as 380 partidas na rodada certa. Quando a ESPN remarca um jogo adiado, ela cria um jogo novo e mantém o antigo como "adiado"; o app descarta o antigo. Sem a temporada completa, o app agrupa por datas (menos preciso com jogos remarcados).

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
npm test    # testes da lógica, incluindo a temporada real de 2026 (tests/data)
```

Não há build nem dependências: os módulos em `js/` rodam direto no navegador.

| Arquivo | O que faz |
| --- | --- |
| `index.html`, `style.css` | Estrutura e visual (mobile first, tema claro e escuro) |
| `js/espn.js` | Busca na ESPN e normaliza jogos, classificação e estatísticas |
| `js/rounds.js` | Monta as rodadas completas (inclusive jogos remarcados) e numera cada uma |
| `js/table.js` | Tabela ao vivo, zonas, últimos 5 jogos, cenários e distâncias |
| `js/insights.js` | Histórias dos jogos, manchetes da rodada, impacto da simulação e números |
| `js/sim.js`, `js/odds-worker.js` | Chances até o fim (Monte Carlo) e sorteio de placares |
| `js/fx.js` | Som de gol, vibração e confete |
| `js/ui.js` | Monta o HTML de cada parte da tela |
| `js/app.js` | Estado, atualização automática e interações |
| `tests/` | Testes: temporada fictícia no formato da ESPN e retrato da temporada real de 2026 com as rodadas oficiais |

A API da ESPN não é oficial e pode mudar de formato sem aviso. Se o app parar de mostrar os jogos, o ponto a ajustar é `js/espn.js`.
