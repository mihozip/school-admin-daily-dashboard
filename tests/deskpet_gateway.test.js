const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const gateway = fs.readFileSync(path.join(root, 'DeskPetGateway.gs'), 'utf8');
const code = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

[
  'function doPost(e)',
  'function setupDeskPetGateway()',
  'function createDeskPetApiToken()',
  'function showDeskPetApiToken()',
  'function resetDeskPetApiToken()',
  'function getDeskPetGatewayStatus()',
  'case "ping"',
  'case "createTask"',
  'case "taskDigest"',
  'case "updateTask"',
  'DESKPET_API_TOKEN',
].forEach((needle) => {
  assert(gateway.includes(needle), `DeskPetGateway.gs missing: ${needle}`);
});

assert(
  !gateway.includes('DESKPET_SPREADSHEET_ID'),
  'Integrated gateway must not require DESKPET_SPREADSHEET_ID',
);

[
  'function getSpreadsheet_()',
  'const TASK_HEADERS',
  'const LOG_HEADERS',
  'function listTasks_',
  'function appendLog_',
].forEach((needle) => {
  assert(code.includes(needle), `Code.gs missing shared contract helper: ${needle}`);
});

console.log('DeskPet integrated gateway contract OK');
