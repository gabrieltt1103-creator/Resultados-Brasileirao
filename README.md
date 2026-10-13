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
- **Secador** (com um time escolhido, liga e desliga no cartão do topo): em cada jogo da rodada, contra quem torcer para o seu time se dar bem, e quem secar só pela rivalidade. Veja abaixo.

**Secador**
- O app descobre o que está em jogo para o seu time: título, vaga no G6 ou fugir do rebaixamento. Risco pequeno também conta: o 14º com 3% de chance de cair ainda olha para baixo. O cartão diz a situação em poucas palavras ("na briga pelo título", "com a mão na taça", "precisa de um milagre") e qual jogo da rodada mais pesa.
- Para cada jogo da rodada, refaz o resto do campeonato 4.000 vezes com cada resultado (vitória do mandante, empate, vitória do visitante), usando os mesmos sorteios nos três, para a diferença vir só do jogo trocado. O jogo ganha linha quando a chance do seu time muda 2 pontos percentuais ou mais entre o melhor e o pior resultado. Com chance pequena vale menos: no título e no G6, um quarto dela (se for de 5% ou mais); no risco de cair, que o torcedor acompanha mesmo pequeno, um oitavo. Assim o 14º com 3,6% de risco vê que o empate entre dois concorrentes diretos é o melhor ("Torça pelo empate · Os dois brigam com você. Risco de cair: 3,6% com empate, 4,1% com vitória do Grêmio"), e o risco pequeno aparece com uma casa decimal. Quem está quase rebaixado vê a chance de escapar. Desses, aparecem no máximo os 3 que mais pesam, para a rodada não virar um mar de selos. A frase mostra os dois números: "Chance de G6: 87% com vitória do Grêmio, 84% com a do Cruzeiro".
- Selos: **Seque o Cruzeiro** (torça contra quem briga com você), **Torça pelo empate** (quando os dois brigam com você), **Seca em dobro** (secar o rival ainda ajuda), **Nariz tapado** (vale torcer pelo rival; em verde-enjoo com um pregador de roupa e "Ninguém precisa saber"), **Clássico dos rivais** (dois rivais se enfrentam: empate) e **Seu jogo** (a chance em cada resultado do próprio jogo; contra o rival, **Clássico**). Jogo que não importa leva só um aviso discreto, "Tanto faz pra você" (ou "Pesa pouco pra você", quando mexe pouco e ficou fora dos 3), para ficar claro que o Secador olhou o jogo; na v2, os que ainda vão acontecer ficam um pouco apagados. Jogo encerrado diz o que o resultado fez ("Com o empate, o risco de cair ficou em 3%", "O Flamengo venceu; o melhor era o empate").
- Tom: as secadas pelo resultado são sérias, só com os números. As que são só pela rivalidade (rival em apuros, clássico dos rivais, "seque mesmo") ganham uma frase curta de torcedor, ligada ao que o rival tem em jogo ("Taça na mão do rival, aqui não", "Libertadores, só pela TV", "A Série B tem vaga sobrando"; no fim, "Meia secada", "Já pode mandar meme no grupo"), e o estado vira "Tá secando" / "Secou". A piada varia de jogo para jogo, para não repetir na rodada.
- Secar pela rivalidade só quando dói: o rival precisa estar numa briga aberta (título a partir de 10%, G entre 15% e 85%, risco de cair entre 8% e 95%) e o jogo precisa mudar 4 pontos ou mais para ele. A frase diz o que ele perde: "Se o Flamengo perder, a chance de título dele cai para 47%".
- Torcer pelo rival só quando compensa: o ganho precisa ser de 3 pontos ou mais e maior que o do rival na briga dele. Se não, o conselho é secar mesmo assim ("A vitória do Flamengo até ajudaria a sua chance de G6, mas também deixaria o Flamengo mais perto do título. Seque mesmo.").
- Rivais de fábrica: os grandes do mesmo estado (os 4 do Rio, os 4 de São Paulo, Atlético e Cruzeiro, Grêmio e Internacional, Athletico e Coritiba, Bahia e Vitória...). Bragantino e Mirassol começam sem rival. Na página do seu time dá para ligar e desligar cada rival, inclusive times de outros estados.
- O conselho de cada jogo fica fixo quando ele começa: durante a partida, o Secador só acompanha se está dando certo (recalcular a cada gol faria a linha mudar ou sumir no meio do jogo). Os que ainda vão começar são refeitos a cada conta. Os conselhos fixados ficam salvos no celular, então valem também depois de recarregar a página.
- Ao vivo, cada jogo diz se está dando certo, o cartão conta quantas secadas estão funcionando e o aviso de gol diz "Secador: ✓ tá dando certo" (ou não). Nos encerrados, se deu certo. Vale para a rodada atual e as próximas, e não usa os placares do simulador. Desligado, o cartão é uma linha só.

**Detalhe do jogo** (toque no cartão)
- Lance a lance com gols e cartões, estatísticas (posse, finalizações, chutes no gol, escanteios, faltas…) e os últimos 5 jogos de cada time.
- **Chances pelo modelo**: vitória de cada time e empate, com o placar sugerido (num jogo ao vivo, a partir do placar atual).
- **O que está em jogo**: em que posição cada time fica se vencer, empatar ou perder, considerando os outros placares do momento.
- **Últimos confrontos**: os 5 jogos mais recentes entre os dois times, em qualquer competição (Série A, Série B, Copa do Brasil, Libertadores, Sul-Americana), com data, placar e o retrospecto ("3 vitórias do Corinthians e 2 empates"), além da sequência quando há uma ("O Corinthians não perde para o Grêmio há 5 jogos"). Jogo de mata-mata decidido nos pênaltis conta como empate e mostra quem passou. Vem do resumo do jogo da ESPN, que agora também é buscado para os jogos que ainda vão acontecer.
- **Fluxo da partida**: a pressão de cada time em cada minuto, com barras para cima (mandante) e para baixo (visitante), os gols e, ao vivo, o minuto atual. Os dois times têm barra no mesmo minuto: espaço vazio é jogo parado (substituições, faltas no meio de campo), barras dos dois lados é jogo lá e cá. Vem do lance a lance da ESPN (na mesma resposta das estatísticas): cada lance de ataque soma para quem atacou (gol 1,5; chute no gol ou na trave 1; para fora 0,6; bloqueado 0,5; escanteio 0,4; falta sofrida perto da área 0,25; impedimento 0,2) e pesa também, cada vez menos, nos 4 minutos seguintes. Diferente dos gráficos que usam todos os toques na bola, mostra a pressão pelas chances criadas, então há minutos sem barra quando nada aconteceu. Ao vivo, o chute mais recente, que a ESPN publica como provisório até reclassificar, já entra pelo texto do lance.
- **Como está (ou como foi) o jogo**: logo abaixo do fluxo, o jogo contado como para um amigo, em 2 ou 3 parágrafos curtos e com poucos números (só o minuto dos lances; os números ficam em Estatísticas):
  - **Um parágrafo por tempo**: quem foi melhor, pela pressão do lance a lance ("O Vasco foi melhor no primeiro tempo, mas não conseguiu marcar", "No segundo tempo, o Remo equilibrou"), mas com o placar mandando: quem faz dois gols a mais no tempo (ou abre dois de vantagem) nunca está num "jogo equilibrado" ("O Athletico-PR foi letal no primeiro tempo", "O Cruzeiro foi mais eficiente no segundo tempo", "O Vasco dominou o segundo tempo"), e os lances na ordem, ligados entre si: gols com o verbo certo (abriu o placar, ampliou, diminuiu, empatou, virou, fez o terceiro), quem marcou de novo ou completou o hat-trick, gol contra, gol anulado pelo VAR ("O empate veio pouco depois, aos 34', com o próprio Danilo Santos"), pênalti perdido e para quê ("teve um pênalti para empatar aos 90+7', mas Reinaldo desperdiçou"), expulsão ("Mesmo com um a menos, diminuiu…"), bola na trave, gol contra a corrente do jogo ("Mesmo assim, foi o Santos que abriu o placar"). Se o placar ainda não trouxe os autores, vêm do lance a lance.
  - **Ao vivo, o agora**: os últimos minutos como impressão ("O Botafogo continua em cima, atrás da virada", "Com um a mais, o Palmeiras está em cima", "o jogo esfriou, com as substituições"). Quando quem vence finaliza bem menos, isso vem antes ("O Athletico-PR finaliza bem menos, mas acertou quase tudo o que chutou"). No intervalo, como foi o primeiro tempo e quem foi para o intervalo na frente.
  - **Encerrado, o veredito** numa frase, pelo placar e pelas estatísticas (finalizações, posse, defesas do goleiro): "Virada no apagar das luzes", "Vitória no sufoco: o Corinthians criou bem mais, mas parou no goleiro do Internacional", "Empate com gosto de derrota para o Vasco", "Vitória merecida, mas com susto no fim", "Goleada sem discussão" ou "Goleada de quem chutou menos". Sem estatísticas nem lance a lance, não há veredito: só o que aconteceu.

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
- **Versão nova do app**: o GitHub Pages marca todos os arquivos com a hora da publicação. Ao abrir o app, ao voltar para ele e a cada 5 minutos, ele compara essa hora com a da página aberta; se saiu uma versão nova, baixa os arquivos novos e recarrega, reabrindo o jogo ou time que estava na tela. Ao abrir ou voltar, isso acontece sozinho; com o app em uso, aparece um aviso ("Saiu uma versão nova do app · Toque para atualizar"). Evita ficar com o código antigo no celular, onde a aba fica aberta por horas ou volta do cache ao reabrir.
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
| `js/sim.js`, `js/odds-worker.js` | Chances até o fim (Monte Carlo), contas do secador e sorteio de placares |
| `js/secador.js` | Secador: rivais por estado, objetivo do time, para quem torcer em cada jogo e as frases |
| `js/fx.js` | Som de gol, vibração e confete |
| `js/ui.js` | Monta o HTML de cada parte da tela (versão atual) |
| `js/ui-v2.js`, `v2/` | Versão 2 do visual: o que muda em relação ao `ui.js`, a página e o CSS |
| `js/app.js` | Estado, atualização automática e interações |
| `tests/` | Testes: temporada fictícia no formato da ESPN e retrato da temporada real de 2026 com as rodadas oficiais |

A API da ESPN não é oficial e pode mudar de formato sem aviso. Se o app parar de mostrar os jogos, o ponto a ajustar é `js/espn.js`.
