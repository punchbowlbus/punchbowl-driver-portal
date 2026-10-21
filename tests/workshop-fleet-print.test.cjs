const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const modulePromise=fs.readFile(path.join(__dirname,'../public/js/workshop_fleet_print.js'),'utf8').then(source=>import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')));
const stamp=new Date('2026-10-22T00:00:00Z');
test('print document contains only supplied filtered rows, labels and filter context',async()=>{
 const m=await modulePromise;
 const html=m.fleetPrintDocument({columns:[{key:'fleet',label:'Fleet'},{key:'depot',label:'Depot'}],rows:[['M0014','Hannans'],['M0007','Hannans']],filters:['Depot: Hannans','Fuel: Diesel'],sort:'Fleet — descending',generatedAt:stamp});
 assert.match(html,/2 vehicles/);assert.match(html,/Depot: Hannans · Fuel: Diesel/);assert.ok(html.indexOf('M0014')<html.indexOf('M0007'));assert.match(html,/size:A4 landscape/);assert.match(html,/table-header-group/);assert.doesNotMatch(html,/Goulburn|<button|Open record/);
});
test('wide reports split visible columns into readable groups with repeated vehicle identity',async()=>{
 const m=await modulePromise;const columns=[{key:'fleet',label:'Fleet'},{key:'rego',label:'Rego'},...Array.from({length:23},(_,i)=>({key:'field'+i,label:'Field '+i}))];
 const groups=m.fleetPrintColumnGroups(columns);
 assert.equal(groups.length,3);assert.ok(groups.every(group=>group.length<=10&&group[0]===0&&group[1]===1));assert.deepEqual(groups.flatMap(group=>group.slice(2)),Array.from({length:23},(_,i)=>i+2));
 const html=m.fleetPrintDocument({columns,rows:[columns.map((_,i)=>'Value '+i)],generatedAt:stamp});assert.match(html,/Part 1 of 3/);assert.match(html,/Part 3 of 3/);assert.equal((html.match(/<td>Value 0<\/td>/g)||[]).length,3);
});
test('text from vehicles, headings and filters is escaped rather than copied as executable markup',async()=>{
 const m=await modulePromise;const html=m.fleetPrintDocument({columns:[{key:'fleet',label:'<script>Heading</script>'}],rows:[['<img src=x onerror=alert(1)>']],filters:['Search: A&B <test>'],generatedAt:stamp});
 assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;img/);assert.match(html,/A&amp;B &lt;test&gt;/);
});
test('a hidden registration column is not reintroduced into wide reports',async()=>{
 const m=await modulePromise;const columns=[{key:'fleet',label:'Fleet'},...Array.from({length:12},(_,i)=>({key:'field'+i,label:'Field '+i}))];const groups=m.fleetPrintColumnGroups(columns);assert.ok(groups.every(group=>group[0]===0));assert.equal(groups.flatMap(group=>group.slice(1)).length,12);
});
