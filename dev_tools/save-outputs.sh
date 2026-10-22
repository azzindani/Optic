#!/bin/bash
# save-outputs.sh: full gateway ingestion per PDF, persisting outputs.
# Writes tmp/markdown/<name>.md and tmp/entities/<name>.json.
# Usage: save-outputs.sh <gateway> (expects turbo tool loaded)
GW=${1:-http://127.0.0.1:3111}
ROOT=/home/opencode/work/Optic
MD=$ROOT/tmp/markdown
EN=$ROOT/tmp/entities
mkdir -p "$MD" "$EN"
find "$ROOT/samples" -type f -name "*.pdf" ! -name "*Zone.Identifier" | sort | while read -r f; do
  name=$(basename "$f")
  J=$(curl -s -X POST $GW/v1/jobs -H 'content-type: application/json' -d '{"tool_id":"turbo-tiny","mode":"batch","input_refs":["pending:upload"]}')
  ID=$(echo "$J" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).id))")
  R=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$GW/v1/jobs/$ID/pdf?entities=1" --data-binary @"$f" -H "Content-Type: application/pdf")
  if [ "$R" != "200" ]; then echo "$name: pdf-upload $R"; continue; fi
  curl -s "$GW/v1/jobs/$ID/events" -H "Accept: text/event-stream" --max-time 300 -o /tmp/out-events.txt 2>/dev/null
  node -e "
const fs=require('fs');
const lines=fs.readFileSync('/tmp/out-events.txt','utf8').split('\n').filter(l=>l.startsWith('data:'));
let md='', allEntities=[], boxCount=0, pages=0;
for(const l of lines){const d=JSON.parse(l.slice(5));
  if(d.text) md+=d.text+'\n';
  if(d.page && !d.text) pages=Math.max(pages,0);
  if(d.entities) for(const e of d.entities) allEntities.push({page:d.page??0,...e});
  if(d.boxes) boxCount+=d.boxes.length;}
fs.writeFileSync('$MD/$name.md'.replace(/\.pdf\.md$/,'.md'), md);
fs.writeFileSync('$EN/$name.json'.replace(/\.pdf\.json$/,'.json'), JSON.stringify({file:'$name',entity_count:allEntities.length,entities:allEntities,entity_box_count:boxCount},null,1));
console.log('$name: md='+md.length+'B entities='+allEntities.length);
"
done
echo OUTPUTS-DONE
