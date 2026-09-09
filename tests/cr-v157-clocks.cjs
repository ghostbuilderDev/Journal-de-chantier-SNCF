const assert=require('node:assert/strict');
require('../cr-off.js');require('../cr-fields.js');
const iso=JournalCRFields.scheduleISO;
assert.equal(iso('2026-09-09T23:55'),'2026-09-09T21:55:00.000Z');
assert.equal(iso('2026-09-10T04:30'),'2026-09-10T02:30:00.000Z');
assert.equal(iso('2026-01-09T23:55'),'2026-01-09T22:55:00.000Z');
// Both occurrences of a repeated hour round-trip, including stored seconds.
for(const previous of ['2026-10-25T00:35:27.123Z','2026-10-25T01:35:27.123Z'])
 assert.equal(iso('2026-10-25T02:35',previous),previous);
assert.equal(iso('2026-10-25T02:40','2026-10-25T01:35:00Z'),'2026-10-25T01:40:00.000Z');
assert.equal(iso('2026-10-25T02:10','','2026-10-25T00:45:00Z'),'2026-10-25T01:10:00.000Z');
assert.throws(()=>iso('2026-03-29T02:30'),/Cette heure n’existe pas/);
assert.equal(iso('2026-03-29T03:05'),'2026-03-29T01:05:00.000Z');
assert.equal(iso(''),null);
const fields={start:{value:'23:55',dataset:{original:''}},start_date:{value:'2026-09-12'},end:{value:'05:00',dataset:{original:''}},end_date:{value:'2026-09-14'}};
const row={querySelector:s=>fields[s.match(/name=(\w+)/)[1]]};
assert.equal(JournalCRFields.readClock(row,'end'),'2026-09-14T03:00:00.000Z');
fields.end_date.value='';assert.throws(()=>JournalCRFields.readClock(row,'end'),/Ouvrir « Date »/);
fields.end.value='';assert.equal(JournalCRFields.readClock(row,'end'),null);
console.log('V15.7 clock round-trips: midnight, weekend, stored offsets, repeated and absent hours OK.');
