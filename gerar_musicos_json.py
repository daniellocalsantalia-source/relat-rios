"""
Utilitário para gerar/regenerar data/musicos.json a partir da planilha do SAM
(Sistema de Acompanhamento de Músicos), fora da interface web. Uso:

    pip install pandas openpyxl
    python gerar_musicos_json.py caminho/para/SAM.xlsx

O arquivo gerado é escrito em ../data/musicos.json.

A planilha deve conter as colunas (nomes exatamente como no cabeçalho do
SAM): NOME, INSTRUMENTO, LOCALIDADE, CARGO/MINISTÉRIO, NIVEL,
Encarregado Regional, Secretário, Musico ou Canditado, Setor,
Musico ou organista, CLASSE, Cidade, Tipo.
"""
import sys, json
import pandas as pd

COLS = {
    "NOME": "nome",
    "INSTRUMENTO": "instrumento",
    "LOCALIDADE": "localidade",
    "CARGO/MINISTÉRIO": "cargoMinisterio",
    "NIVEL": "nivel",
    "Encarregado Regional": "encarregadoRegional",
    "Secretário": "secretario",
    "Musico ou Canditado": "musicoOuCandidato",
    "Setor": "setor",
    "Musico ou organista": "musicoOuOrganista",
    "CLASSE": "classe",
    "Cidade": "cidade",
    "Tipo": "tipo",
}

def main(path):
    df = pd.read_excel(path)
    faltando = [c for c in COLS if c not in df.columns]
    if faltando:
        print(f"ATENÇÃO: colunas ausentes na planilha: {faltando}")
    records = []
    for i, row in df.iterrows():
        rec = {"id": i + 1}
        for col_origem, chave in COLS.items():
            valor = row[col_origem] if col_origem in df.columns else ""
            rec[chave] = "" if pd.isna(valor) else str(valor).strip()
        records.append(rec)

    tipos = sorted(set(r["tipo"] for r in records if r["tipo"]))
    setores = sorted(set(r["setor"] for r in records if r["setor"]))
    out = {
        "meta": {
            "totalRegistros": len(records),
            "fonte": path,
            "tipos": tipos,
            "setores": setores,
        },
        "musicos": records,
    }
    with open("../data/musicos.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"OK: {len(records)} músico(s)/candidato(s) gravado(s) em ../data/musicos.json")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python gerar_musicos_json.py caminho/para/SAM.xlsx")
        sys.exit(1)
    main(sys.argv[1])
