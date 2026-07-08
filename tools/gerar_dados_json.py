"""
Utilitário para regenerar data/dados.json a partir da planilha Musica.xlsx
(aba "Ensaios"), fora da interface web. Uso:

    pip install pandas openpyxl
    python gerar_dados_json.py caminho/para/Musica.xlsx

O arquivo gerado é escrito em ../data/dados.json.
"""
import sys, json, re, unicodedata
import pandas as pd

MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho",
         "Agosto","Setembro","Outubro","Novembro","Dezembro"]
MES_MAP = {m.upper(): i+1 for i, m in enumerate(MESES)}
DIAS = {"domingo":0,"segunda-feira":1,"terca-feira":2,"terça-feira":2,
        "quarta-feira":3,"quinta-feira":4,"sexta-feira":5,"sabado":6,"sábado":6}
DIA_LABEL = {0:"Domingo",1:"Segunda-feira",2:"Terça-feira",3:"Quarta-feira",
             4:"Quinta-feira",5:"Sexta-feira",6:"Sábado"}
TIPO_MAP = {"Mensal":"Mensal","Bimestral":"Bimestral","Extras":"Extra",
            "Quatrimestrais":"Quadrimestral","Sementral":"Semestral","Trimestrais":"Trimestral"}
SETORES_TERESINA = {"Setor 1","Setor 2","Setor 3","Setor 4","Setor 5","Setor 10"}

def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')

def parse_dia_semana(s):
    m = re.match(r'^(\d)ª?\s*(.+)$', s.strip())
    ordinal = int(m.group(1))
    raw = m.group(2).strip().lower()
    idx = DIAS.get(raw, DIAS.get(strip_accents(raw)))
    return ordinal, idx

def cidade_for(setor, congregacao):
    if setor in SETORES_TERESINA: return "Teresina"
    if setor == "Setor Floriano": return "Floriano" if congregacao == "Floriano Central" else congregacao
    if setor == "Setor Parnaiba": return "Parnaíba" if congregacao == "Parnaiba Central" else congregacao
    if setor == "Setor Campo Maior": return congregacao
    if setor == "Setor Timon": return "Timon"
    return congregacao

def main(path):
    df = pd.read_excel(path, sheet_name='Ensaios')
    records = []
    for i, row in df.iterrows():
        ordinal, dia_idx = parse_dia_semana(row['Dia_Semana'])
        mes_num = MES_MAP[row['mes'].strip().upper()]
        tipo = TIPO_MAP.get(row['TIPO'].strip(), row['TIPO'].strip())
        h = row['HORARIO']
        obs = row['OBS'] if pd.notna(row['OBS']) else ""
        records.append({
            "id": i+1, "mesNumero": mes_num, "mes": MESES[mes_num-1],
            "diaSemanaOrdinal": ordinal, "diaSemanaIndice": dia_idx,
            "diaSemanaLabel": DIA_LABEL[dia_idx], "diaSemanaTexto": f"{ordinal}ª {DIA_LABEL[dia_idx]}",
            "congregacao": row['Congregação'].strip(),
            "cidade": cidade_for(row['Setor'].strip(), row['Congregação'].strip()),
            "setor": row['Setor'].strip(), "tipo": tipo,
            "horario": f"{h.hour:02d}:{h.minute:02d}",
            "encarregadoLocal": row['Encarregado Local'].strip(),
            "encarregadoRegional": row['Encarregado Regional'].strip(),
            "observacoes": obs.strip() if isinstance(obs, str) else ""
        })
    out = {"meta": {"totalRegistros": len(records), "fonte": path,
                     "tiposEnsaio": ["Mensal","Bimestral","Trimestral","Extra","Quadrimestral","Semestral"]},
           "ensaios": records}
    with open('../data/dados.json', 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"OK: {len(records)} ensaios gravados em ../data/dados.json")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python gerar_dados_json.py caminho/para/Musica.xlsx"); sys.exit(1)
    main(sys.argv[1])
