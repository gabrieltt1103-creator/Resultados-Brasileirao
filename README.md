# Rodada ao Vivo · Brasileirão

Micro app para acompanhar no celular a rodada do Brasileirão Série A em tempo real e entender o que ela muda no campeonato.

## O que tem

**Jogos**
- A rodada completa, com os 10 jogos: inclusive os adiados, os remarcados para outro dia e os antecipados.
- Placar ao vivo com minuto, intervalo, encerrados, adiados e horário dos próximos. Jogos de outras rodadas que acontecem hoje aparecem no topo.
- Autores dos gols (pênalti e gol contra), cartões vermelhos e a posição de cada time na tabela, com seta de quem subiu ou caiu na rodada.
- **Resumo da rodada** escrito automaticamente: troca de liderança, quem entra ou sai do G6 e do Z4, viradas, zebras, gols no fim, hat-tricks e goleadas. Antes da bola rolar vira uma prévia com o jogão e a briga contra a queda.
- Aviso de **GOL** no topo da tela, placar piscando em amarelo, vibração no Android e som de torcida opcional (ícone de alto-falante). O autor do gol só aparece quando o lance já chegou da ESPN (antes disso o aviso diz só de quem foi o gol), e gol retirado do placar (anulado ou corrigido) também ganha aviso.
- Botão para compartilhar os placares da rodada no WhatsApp ou onde quiser.

**Detalhe do jogo** (toque no cartão)
- Lance a lance com gols e cartões, estatísticas (posse, finalizações, chutes no gol, escanteios, faltas…) e os últimos 5 jogos de cada time.
- **Chances pelo modelo**: vitória de cada time e empate, com o placar sugerido (num jogo ao vivo, a partir do placar atual).
- **O que está em jogo**: em que posição cada time fica se vencer, empatar ou perder, considerando os outros placares do momento.
- **Fluxo da partida**: quem estava pressionando em cada minuto, com barras para cima (mandante) e para baixo (visitante), os gols e, ao vivo, o minuto atual. Vem do lance a lance da ESPN (na mesma resposta das estatísticas): cada lance de ataque soma para quem atacou (gol 1,5; chute no gol ou na trave 1; para fora 0,6; bloqueado 0,5; escanteio 0,4; falta sofrida perto da área 0,25; impedimento 0,2) e pesa também, cada vez menos, nos 4 minutos seguintes. Uma frase diz quem pressionou mais e o melhor momento do outro time. Diferente dos gráficos que usam todos os toques na bola, mostra a pressão pelas chances criadas, então há minutos sem barra quando nada aconteceu.

**Tabela**
- Classificação **ao vivo**: como fica se os jogos terminarem agora, com o resultado parcial de cada time e setas de movimento. Calculada a partir de todos os jogos da temporada; se faltarem jogos, usa a classificação oficial da ESPN corrigida com a rodada. A nota no topo diz quantos jogos da rodada já entraram e quantos faltam.
- **Conferida com a classificação oficial**: para cada time com o mesmo número de jogos nas duas, os pontos precisam bater. Se não batem (punição no tribunal, placar corrigido), vale o número oficial e a diferença aparece embaixo da tabela.
- Pontos, jogos, V/E/D, saldo, gols pró e contra, aproveitamento e últimos 5 jogos. Nome e posição ficam fixos ao rolar para o lado.
- Zonas de Libertadores, Sul-Americana e rebaixamento.
- Toque num time para ver distância para o líder, para o G6 e para o Z4, os próximos 5 jogos (com rodada e posição de cada adversário) e os últimos resultados.

**Simular**
- Escolha placares para os jogos que faltam (com + e −, ou nos botões de vitória e empate, que mostram a chance de cada resultado e aplicam o placar mais provável dele) e veja a tabela mudar na hora, com quem sobe, quem cai e quem entra ou sai do G6 e do Z4.
- **Sugerir placares** preenche a rodada com a sugestão do modelo: o resultado mais provável (empate quando as chances dos dois times ficam a menos de 8 pontos) com o placar mais provável dentro dele. Dá para simular várias rodadas: tudo o que foi simulado entra na conta.
- **Chances até o fim**: título, G6 e Z4 para cada time, em 3.000 simulações do restante do campeonato. As chances mudam com os placares que você escolher. A explicação do cálculo fica recolhida em "Como calculamos".
- Os jogos já encerrados da rodada ficam numa lista recolhida, com o resultado real.

**Como o modelo funciona**
- Força de ataque e de defesa de cada time pelos gols marcados e sofridos, misturando três janelas: últimos 5 jogos (40%), últimos 10 (35%) e a temporada (25%). Cada janela recebe 8 jogos "fictícios" na média do campeonato, para poucos jogos não pesarem demais.
- Vantagem de jogar em casa medida na própria temporada.
- Gols esperados = média do campeonato × ataque × defesa do adversário × fator casa/fora; placares pela distribuição de Poisson.
- Pesos escolhidos testando na temporada 2026: prevendo cada jogo só com os anteriores, a mistura errou menos que a média da temporada (log-loss 1,036 contra 1,042) e que só o mando de campo (1,061). A sugestão acertou o resultado em 48% dos jogos e o placar exato em 15%.

**Números**
- Gols da rodada, média por jogo (comparada com a média do campeonato até aqui), empates, cartões, quem venceu mais (mandante ou visitante), em que minutos saem os gols, artilheiros da rodada e maior goleada.
- Times em alta e em baixa nos últimos 5 jogos, melhor ataque e melhor defesa.

**Meu time**
- Escolha seu time (o convite fica no fim da aba Jogos, para não tomar o lugar da rodada): ele ganha destaque e um cartão no topo diz como ele está ("se terminar assim, sobe para 4º"). Gol dele solta confete. No detalhe do time aparecem as chances dele até o fim.

**Status dos dados**
- No rodapé, mostra o que carregou e o que falhou (jogos da temporada, classificação, conferência com a tabela oficial, placar ao vivo, estatísticas). Se alguma parte não aparecer, um print dessa tela diz o motivo.
- No topo, ao lado do botão de atualizar, fica há quanto tempo os placares foram lidos ("Atualizado há 30 s"). Fica amarelo quando está sem conexão, quando mostra dados salvos de outra hora enquanto atualiza, ou quando, com jogo rolando, passa mais de 1,5 min sem atualizar.

Atualiza sozinho a cada 30 s durante os jogos e a cada 2 min fora deles, e pausa quando o app sai da tela para poupar bateria e dados. Tema claro e escuro conforme o celular.

### Como os dados chegam

Os dados vêm da API pública da ESPN (`site.api.espn.com`), chamada direto do navegador, sem servidor e sem chave de API. A ESPN aceita no parâmetro `dates` um ano, um mês (`202610`) ou um dia (`20261011`), mas recusa intervalos (`20261001-20261031`) no Brasileirão.

- **Placar ao vivo, dia a dia**: a cada atualização vêm o dia de hoje e os dias com jogo rolando; a cada 5 min (ou ao tocar em atualizar, trocar de rodada ou voltar ao app), também ontem, amanhã e os dias da rodada aberta que ainda têm jogo. São respostas pequenas (6 KB) e não esperam por mais nada.
- **Temporada, em segundo plano**: a primeira leitura traz o ano inteiro numa chamada (`dates=2026`, 270 KB) e guarda no celular. Depois, como o que já passou não muda, só os meses que ainda podem mudar (do mês da última leitura até dezembro, cerca de 60 KB). Uma vez por dia, o ano inteiro de novo. Nos testes, a ESPN às vezes levou de 15 a 30 s para responder a chamada da temporada; por isso o placar não depende dela.
- **Ao abrir**: os dados salvos aparecem na hora (sinalizados no topo) e a busca começa antes do primeiro desenho da tela. Sem dados salvos, os jogos de hoje aparecem em cerca de 1 s e o resto da rodada chega com a temporada.
- **Prazo e ordem**: toda chamada tem prazo (12 a 25 s) e, se um dia falhar, os outros são aproveitados. Cada jogo guarda a hora da leitura que o trouxe e só é trocado por uma leitura mais nova, então uma resposta atrasada não desfaz um placar mais recente.
- **Abertura da página**: as fontes não seguram a primeira pintura e os módulos JS são baixados todos juntos (`modulepreload`).

A ESPN não informa a rodada de cada jogo. O app usa o fato de que, no Brasileirão, a rodada r+19 repete a rodada r com o mando invertido: os dois jogos de cada confronto ficam no mesmo par de rodadas, então um jogo adiado, antecipado ou de rodada dividida é colocado na rodada certa pelo outro jogo do confronto. Conferido contra as rodadas oficiais (Cartola FC) de 2026: as 380 partidas na rodada certa. Quando a ESPN remarca um jogo adiado, ela cria um jogo novo e mantém o antigo como "adiado"; o app descarta o antigo. Sem a temporada completa, o app agrupa por datas (menos preciso com jogos remarcados).

## Duas versões do visual

O app tem duas aparências com os mesmos dados e a mesma lógica (tabela, rodadas, simulação, chances), para comparar qual funciona melhor:

- **Versão atual**: `https://gabrieltt1103-creator.github.io/Resultados-Brasileirao/`
- **Versão 2** ("Arquibancada"): `https://gabrieltt1103-creator.github.io/Resultados-Brasileirao/v2/`

Na v2, a cor dos clubes aparece só num fio embaixo de cada time (cinza para quem perdeu), a tabela é uma lista só com a zona marcada no número da posição, o resumo vira frases puxadas por um número ("90+7'", "4–1", "Z4"), cada gráfico termina com uma frase que diz o que ele mostra, o simulador lista só o que muda na tabela e as chances por objetivo (título, G6, risco de cair), o detalhe do jogo conta como foi antes dos números, e as abas ficam embaixo, perto do polegar.

Por dentro: `index.html` e `v2/index.html` carregam o mesmo `js/app.js`; o atributo `data-ui="v2"` da página faz o app usar `js/ui-v2.js` no lugar de `js/ui.js`. A v2 carrega o `style.css` da versão atual e o `v2/style.css` por cima, então as janelas que não mudaram (detalhe do time, status dos dados, escolha do time) ganham as cores novas sem duplicar código. As duas versões dividem os dados salvos no celular.

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
| `js/season.js` | Quais meses da temporada recarregar e o que a ESPN tirou da lista |
| `js/rounds.js` | Monta as rodadas completas (inclusive jogos remarcados) e numera cada uma |
| `js/table.js` | Tabela ao vivo, conferência com a classificação oficial, zonas, últimos 5 jogos, cenários e distâncias |
| `js/insights.js` | Histórias dos jogos, manchetes da rodada, impacto da simulação, números e as frases de resumo |
| `js/sim.js`, `js/odds-worker.js` | Chances até o fim (Monte Carlo) e sorteio de placares |
| `js/fx.js` | Som de gol, vibração e confete |
| `js/ui.js` | Monta o HTML de cada parte da tela (versão atual) |
| `js/ui-v2.js`, `v2/` | Versão 2 do visual: o que muda em relação ao `ui.js`, a página e o CSS |
| `js/app.js` | Estado, atualização automática e interações |
| `tests/` | Testes: temporada fictícia no formato da ESPN e retrato da temporada real de 2026 com as rodadas oficiais |

A API da ESPN não é oficial e pode mudar de formato sem aviso. Se o app parar de mostrar os jogos, o ponto a ajustar é `js/espn.js`.
