#!/bin/bash
# Full-corpus sweep: structured OCR per PDF, stats TSV.
# Usage: sweep.sh <turbo-base> <samples-dir> <out-tsv>
BASE=${1:-http://localhost:8000}
SAMPLES=${2:-/home/opencode/work/Optic/samples}
OUT=${3:-/home/opencode/work/Optic/tmp/sweep.tsv}
echo -e "file\tbytes\tstatus\tms\tpages\twords\tavgconf\tminconf" > "$OUT"
find "$SAMPLES" -type f -name "*.pdf" ! -name "*Zone.Identifier" | sort | while read -r f; do
  name=$(basename "$f")
  bytes=$(stat -c%s "$f")
  START=$(date +%s%N)
  CODE=$(curl -s -o /tmp/sweep-one.json -w "%{http_code}" --max-time 300 -X POST "$BASE/ocr/pdf" --data-binary @"$f" -H "Content-Type: application/pdf")
  END=$(date +%s%N)
  MS=$(( (END-START)/1000000 ))
  if [ "$CODE" = "200" ]; then
    STATS=$(node -e "
const d=require('/tmp/sweep-one.json');
let n=0,sum=0,min=1;
for(const p of d.pages||[]) for(const r of p.results||[]){n++;sum+=r.confidence;min=Math.min(min,r.confidence);}
console.log((d.pages||[]).length+'\t'+n+'\t'+(n?(sum/n).toFixed(4):'-')+'\t'+(n?min.toFixed(3):'-'));")
    echo -e "$name\t$bytes\t200\t$MS\t$STATS" | tee -a "$OUT"
  else
    echo -e "$name\t$bytes\t$CODE\t$MS\t-\t-\t-\t-" | tee -a "$OUT"
  fi
done
echo SWEEP-DONE
