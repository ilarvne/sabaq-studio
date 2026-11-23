import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedCitedClaims, supportedClaims } from '@sabaq/agent/evidence';

test('figures and direct quotes belong to their own cited passages', () => {
  const sources = new Map([['E1', 'Жаңбыр суы 36 мл.'], ['E2', 'В лаборатории 12 мл. «Новый образец».']]);
  assert.ok(supportedCitedClaims('Жаңбыр суы 36 мл. [[E1]] Лаборатория — 12 мл. [[E2]]', sources));
  assert.equal(supportedCitedClaims('Жаңбыр суы 12 мл. [[E1]] Лаборатория — 36 мл. [[E2]]', sources), false);
  assert.equal(supportedCitedClaims('«Новый образец» [[E1]] Есть данные. [[E2]]', sources), false);
  assert.ok(supportedCitedClaims('В двух образцах 36 и 12 мл. [[E1]], [[E2]]', sources));
  assert.equal(supportedCitedClaims('Лаборатория 12 мл. [[E3]]', sources), false);
  assert.equal(supportedCitedClaims('Ответ из текста [[E2]]. Ещё 36 мл.', sources), false);
  assert.ok(supportedCitedClaims('12 мл.', new Map([['E2', '12 мл.']])));
});

test('a supported number cannot borrow another measurement unit or part of a recorded date',()=>{
  const sources=['12 мая 2020 года получено 36 мл. 15 июня 2021 года получено 21 см.'];
  assert.ok(supportedClaims('12 мамыр 2020: 36 mL.',sources));
  assert.equal(supportedClaims('On June 12, 2020, we collected 36 ml.',sources),false);
  assert.equal(supportedClaims('Длина 36 см.',sources),false);
  assert.ok(supportedClaims('On June 15, 2021 we measured 21 cm.',sources));
});
