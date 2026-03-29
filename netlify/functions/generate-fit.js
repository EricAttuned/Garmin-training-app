var FIT_HEADER_SIZE = 14, FIT_MESG_DEFINITION = 0x40, FIT_MESG_DATA = 0x00;
var MESG_FILE_ID = 0, MESG_WORKOUT = 26, MESG_WORKOUT_STEP = 27;
var FIT_UINT16 = 132, FIT_UINT32 = 134, FIT_STRING = 7, FIT_ENUM = 0;
function FitWriter() { this.buffers = []; this.dataSize = 0; }
FitWriter.prototype.writeUint8 = function(v) { var b = Buffer.alloc(1); b.writeUInt8(v & 0xff, 0); this.buffers.push(b); this.dataSize += 1; };
FitWriter.prototype.writeUint16 = function(v) { var b = Buffer.alloc(2); b.writeUInt16LE(v & 0xffff, 0); this.buffers.push(b); this.dataSize += 2; };
FitWriter.prototype.writeUint32 = function(v) { var b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); this.buffers.push(b); this.dataSize += 4; };
FitWriter.prototype.writeString = function(s, n) { var b = Buffer.alloc(n, 0); b.write(s.substring(0, n - 1), "utf8"); this.buffers.push(b); this.dataSize += n; };
FitWriter.prototype.toBuffer = function() { return Buffer.concat(this.buffers); };
function fitCrc16(data) { var t = [0x0000,0xcc01,0xd801,0x1400,0xf001,0x3c00,0x2800,0xe401,0xa001,0x6c00,0x7800,0xb401,0x5000,0x9c01,0x8801,0x4400]; var c = 0; for (var i = 0; i < data.length; i++) { var b = data[i]; var tmp = t[c & 0xf]; c = (c >> 4) & 0x0fff; c = c ^ tmp ^ t[b & 0xf]; tmp = t[c & 0xf]; c = (c >> 4) & 0x0fff; c = c ^ tmp ^ t[(b >> 4) & 0xf]; } return c; }
function paceToFitSpeed(p) { if (!p) return 0; var s = typeof p === "string" ? p : p.min || p; var parts = s.split(":"); var sec = parseInt(parts[0]) * 60 + parseInt(parts[1] || 0); return sec > 0 ? Math.round((1000 / sec) * 1000) : 0; }
function flattenSteps(steps) { var flat = []; for (var i = 0; i < steps.length; i++) { var step = steps[i]; if (step.type === "repeat") { var ri = flat.length; for (var j = 0; j < step.steps.length; j++) flat.push(Object.assign({}, step.steps[j])); flat.push({ type: "repeat_marker", reps: step.reps, targetStep: ri }); } else flat.push(step); } return flat; }
function stepIntensity(s) { if (s.type === "warmup") return 2; if (s.type === "cooldown") return 3; if (s.type === "recovery") return 1; return 0; }
function buildFitWorkout(workout) {
  var w = new FitWriter(), name = (workout.label || "Training Run").substring(0, 40), NL = 48;
  var fs = flattenSteps(workout.steps || []), ns = fs.length;
  w.writeUint8(FIT_HEADER_SIZE); w.writeUint8(0x20); w.writeUint16(0x08f5); w.writeUint32(0); w.writeString(".FIT", 4); w.writeUint16(0);
  w.writeUint8(FIT_MESG_DEFINITION); w.writeUint8(0); w.writeUint8(0); w.writeUint16(MESG_FILE_ID); w.writeUint8(4);
  w.writeUint8(0); w.writeUint8(1); w.writeUint8(FIT_ENUM); w.writeUint8(1); w.writeUint8(2); w.writeUint8(FIT_UINT16); w.writeUint8(2); w.writeUint8(2); w.writeUint8(FIT_UINT16); w.writeUint8(3); w.writeUint8(4); w.writeUint8(FIT_UINT32);
  w.writeUint8(FIT_MESG_DATA); w.writeUint8(5); w.writeUint16(1); w.writeUint16(0); w.writeUint32(12345);
  w.writeUint8(FIT_MESG_DEFINITION | 1); w.writeUint8(0); w.writeUint8(0); w.writeUint16(MESG_WORKOUT); w.writeUint8(3);
  w.writeUint8(4); w.writeUint8(1); w.writeUint8(FIT_ENUM); w.writeUint8(6); w.writeUint8(2); w.writeUint8(FIT_UINT16); w.writeUint8(8); w.writeUint8(NL); w.writeUint8(FIT_STRING);
  w.writeUint8(FIT_MESG_DATA | 1); w.writeUint8(1); w.writeUint16(ns); w.writeString(name, NL);
  w.writeUint8(FIT_MESG_DEFINITION | 2); w.writeUint8(0); w.writeUint8(0); w.writeUint16(MESG_WORKOUT_STEP); w.writeUint8(7);
  w.writeUint8(254); w.writeUint8(2); w.writeUint8(FIT_UINT16); w.writeUint8(0); w.writeUint8(24); w.writeUint8(FIT_STRING); w.writeUint8(1); w.writeUint8(1); w.writeUint8(FIT_ENUM); w.writeUint8(2); w.writeUint8(4); w.writeUint8(FIT_UINT32); w.writeUint8(3); w.writeUint8(1); w.writeUint8(FIT_ENUM); w.writeUint8(4); w.writeUint8(4); w.writeUint8(FIT_UINT32); w.writeUint8(5); w.writeUint8(1); w.writeUint8(FIT_ENUM);
  for (var i = 0; i < fs.length; i++) { var s = fs[i]; w.writeUint8(FIT_MESG_DATA | 2); w.writeUint16(i); if (s.type === "repeat_marker") { w.writeString("Repeat", 24); w.writeUint8(6); w.writeUint32(s.targetStep); w.writeUint8(1); w.writeUint32(s.reps); w.writeUint8(0); } else { w.writeString((s.label || "Run").substring(0, 23), 24); if (s.distance) { var m = s.unit === "km" ? s.distance * 1000 : s.distance; w.writeUint8(0); w.writeUint32(Math.round(m * 100)); } else { w.writeUint8(0); w.writeUint32(0); } if (s.pace) { w.writeUint8(0); w.writeUint32(paceToFitSpeed(s.pace)); } else { w.writeUint8(1); w.writeUint32(0); } w.writeUint8(stepIntensity(s)); } }
  var raw = w.toBuffer(); raw.writeUInt32LE(raw.length - FIT_HEADER_SIZE, 4); raw.writeUInt16LE(fitCrc16(raw.slice(0, 12)), 12);
  var fc = fitCrc16(raw); var cb = Buffer.alloc(2); cb.writeUInt16LE(fc, 0); return Buffer.concat([raw, cb]);
}
exports.handler = async (event) => {
  var headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: Object.assign({}, headers, { "Content-Type": "application/json" }), body: JSON.stringify({ error: "Method not allowed" }) };
  try {
    var body = JSON.parse(event.body); var workout = body.workout, date = body.date;
    if (!workout || !workout.steps || workout.steps.length === 0) return { statusCode: 400, headers: Object.assign({}, headers, { "Content-Type": "application/json" }), body: JSON.stringify({ error: "Workout with steps required" }) };
    var buf = buildFitWorkout(workout);
    var filename = "RunForge_" + (workout.label || "workout").replace(/[^a-zA-Z0-9]/g, "_") + "_" + (date || "today") + ".fit";
    return { statusCode: 200, headers: Object.assign({}, headers, { "Content-Type": "application/octet-stream", "Content-Disposition": 'attachment; filename="' + filename + '"', "Content-Transfer-Encoding": "base64" }), body: buf.toString("base64"), isBase64Encoded: true };
  } catch (err) { console.error("FIT error:", err); return { statusCode: 500, headers: Object.assign({}, headers, { "Content-Type": "application/json" }), body: JSON.stringify({ error: err.message }) }; }
};
