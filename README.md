# Pauta — Calendário de Ensaios Musicais

Aplicação web (HTML + CSS + JavaScript + Bootstrap 5 + FullCalendar + SheetJS)
para gerenciar o calendário de ensaios do ministério de música, gerada a
partir da planilha `Musica.xlsx` (aba **Ensaios**, 982 registros).

## Como executar

Não há build nem dependências pagas. Basta servir a pasta como um site
estático (necessário por causa do `fetch('data/dados.json')`; abrir o
`index.html` direto com duplo clique pode bloquear esse carregamento em
alguns navegadores por causa da política `file://`).

```bash
# qualquer servidor estático resolve, por exemplo:
cd pauta-ensaios
python3 -m http.server 8080
# depois abra http://localhost:8080
```

## Estrutura de pastas

```
pauta-ensaios/
├── index.html          # estrutura da aplicação (dashboard, tabela, estatísticas, importação)
├── css/styles.css       # tema (claro/escuro), layout responsivo, identidade visual
├── js/app.js             # toda a lógica: motor de datas, filtros, calendário, tabelas, import/export
├── data/dados.json        # dados extraídos da planilha (regras recorrentes, não datas fixas)
└── tools/gerar_dados_json.py  # script auxiliar para regenerar dados.json a partir de um .xlsx
```

## Como as datas são calculadas

A planilha descreve os ensaios como regras recorrentes, por exemplo:
"3ª segunda-feira" de "Janeiro". Em vez de gravar uma data fixa,
`data/dados.json` guarda a regra (mês + posição ordinal + dia da semana) e
`js/app.js` calcula a data real para **qualquer ano** selecionado no menu
lateral, usando a função `nthWeekdayOfMonth(ano, mes, diaDaSemana, ordinal)`.
Isso significa que o calendário de 2026, 2027 etc. é gerado automaticamente,
sem precisar reimportar a planilha todo ano. Quando a 5ª ocorrência de um dia
não existe em determinado mês (ex.: "5ª segunda-feira" em um mês sem 5
segundas-feiras), o ensaio simplesmente não aparece naquele mês/ano — como
esperado.

Ao importar uma planilha nova pelo menu **Importar Excel**, se a coluna
`Data` vier preenchida com uma data específica, esse registro passa a ter
data fixa (aparece só naquele ano); se vier vazia, o sistema usa
`Mês` + `Dia_Semana` para gerar a regra recorrente, do mesmo jeito que os
dados originais.

## Observação sobre a coluna "Cidade"

A planilha original não tem uma coluna de cidade separada da congregação.
Como os setores numerados (Setor 1–5 e Setor 10) reúnem bairros de Teresina
e os setores nomeados (Floriano, Parnaíba, Campo Maior, Timon) reúnem
municípios distintos da região, o script de conversão preencheu:

- **Setor 1, 2, 3, 4, 5, 10** → Cidade = "Teresina"
- **Setor Floriano / Parnaíba / Campo Maior / Timon** → Cidade = nome da
  própria congregação (que já corresponde ao município, ex.: "Piripiri",
  "Barras", "Uruçuí")

Se algum mapeamento estiver incorreto, edite `data/dados.json` diretamente
(campo `cidade` de cada ensaio) ou reimporte uma planilha já com uma coluna
`Cidade` explícita — o importador do app usa essa coluna quando presente.

## Persistência local

Quando você importa uma planilha pelo app, os dados são salvos no
`localStorage` do navegador (chave `pauta.ensaios.v1`) e passam a ter
prioridade sobre `data/dados.json` nas próximas visitas. Para voltar aos
dados originais, limpe o localStorage do site ou rode no console:

```js
localStorage.removeItem('pauta.ensaios.v1'); location.reload();
```

## Integração futura com Supabase / Firebase

Toda leitura/escrita de dados passa pelo objeto `DB` no topo de `js/app.js`:

```js
const DB = {
  async getRegras() { ... },
  async saveRegras(regras) { ... },
  async resetToOriginal() { ... }
};
```

Para migrar para Supabase ou Firebase, basta reimplementar esses três
métodos mantendo a mesma assinatura (recebem/retornam a mesma lista de
"regras" de ensaio) — nenhuma outra parte do app.js precisa mudar. Um
exemplo de implementação com Supabase está comentado dentro do próprio
objeto `DB`.

## Funcionalidades implementadas

- Dashboard com calendário mensal (FullCalendar) e alternância para tabela
- Filtros combináveis: Setor, Encarregado Regional, Encarregado Local,
  Congregação, Cidade, Tipo de Ensaio, Mês, Dia da Semana
- Clique em um evento do calendário ou linha da tabela abre modal com todos
  os detalhes
- Cores por tipo de ensaio (Mensal=azul, Bimestral=verde, Trimestral=laranja,
  Extra=roxo, Quadrimestral=vermelho, Semestral=cinza)
- Tabela completa com busca, ordenação por coluna, paginação, exportação
  para Excel (SheetJS) e PDF (jsPDF + AutoTable)
- Cards de estatísticas (total de ensaios, congregações, setores,
  encarregados regionais) e página de estatísticas com distribuição por
  setor, encarregado regional, tipo e cidade
- Tema claro/escuro, menu lateral responsivo (colapsa em mobile)
- Importação de novas planilhas .xlsx com validação linha a linha e opção
  de substituir ou adicionar aos dados atuais
- Seletor de ano no menu lateral, que recalcula automaticamente todas as
  datas do calendário
