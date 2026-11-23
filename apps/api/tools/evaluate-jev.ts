import {parseArgs} from 'node:util';
import {defaultJevModel,scoreJevSupport} from '../src/assistant/jev';

const endpoint='https://api.typesafe.ai/v1/systemone';
const source='https://science.nasa.gov/mars/moons/';
const examples={
  en:{passage:'Mars has two natural satellites, Phobos and Deimos. Phobos is the larger of the two.',
    entailed:'Deimos is smaller than Phobos.',contradicted:'Deimos is larger than Phobos.',absent:'Deimos takes about 30 hours to orbit Mars.'},
  ru:{passage:'Вокруг Марса обращаются два естественных спутника — Фобос и Деймос. Фобос крупнее Деймоса.',
    entailed:'Из двух спутников Марса меньший — Деймос.',contradicted:'Деймос крупнее Фобоса.',absent:'Деймос совершает оборот вокруг Марса примерно за 30 часов.'},
  kk:{passage:'Марстың Фобос және Деймос деген екі табиғи серігі бар. Фобос Деймостан үлкен.',
    entailed:'Марстың екі серігінің кішісі — Деймос.',contradicted:'Деймос Фобостан үлкен.',absent:'Деймос Марсты шамамен 30 сағатта бір айналып шығады.'},
};

const fixtures=Object.entries(examples).flatMap(([language,example])=>
  (['entailed','contradicted','absent'] as const).map(kind=>({
    id:language+'-'+kind,language,kind,passages:[example.passage],claim:example[kind]+' [1]',expected:kind==='entailed'?1:0,
  })));
const usage='bun run eval:jev [--dry-run]';
async function main() {
  const {values}=parseArgs({options:{'dry-run':{type:'boolean'},help:{type:'boolean'}},allowPositionals:false,strict:true});
  if(values.help){console.log(usage);return;}
  const pinned=process.env.STUDIO_JEV_MODEL?.trim();
  if(pinned && !/^jev-\d+\.\d+\.\d+$/u.test(pinned))
    throw new Error('STUDIO_JEV_MODEL must be a pinned Jev model version, for example jev-1.13.0.');
  const model=pinned || defaultJevModel;
  const benchmark={dataset:'mars-moons-v1',source,endpoint,requestedModel:model,caseCount:fixtures.length};
  if(values['dry-run']) {
    console.log(JSON.stringify({...benchmark,mode:'dry-run',requestsSent:0,fixtures},null,2));
    return;
  }
  const apiKey=process.env.TYPESAFE_API_KEY?.trim();
  if(!apiKey) throw new Error('Set TYPESAFE_API_KEY for a scored run, or use --dry-run to inspect the public fixtures.');
  const decisionThreshold=.9;
  let sumSquaredError=0,correct=0;
  for(const {id,language,kind,passages,claim,expected} of fixtures) {
    let probability:number;
    try {
      probability=await scoreJevSupport({endpoint,apiKey,model,claim,passages,signal:AbortSignal.timeout(30_000)});
    }catch {throw new Error('Jev scoring failed for '+id+'. Check the account, model and service availability.');}
    if(!Number.isFinite(probability) || probability<0 || probability>1) throw new Error('Invalid support probability for '+id+'.');
    sumSquaredError+=(probability-expected)**2;
    correct+=Number(Number(probability>=decisionThreshold)===expected);
    console.log(JSON.stringify({id,language,kind,expected,probability}));
  }
  console.log(JSON.stringify({...benchmark,mode:'scored',decisionThreshold,correct,brierScore:sumSquaredError/fixtures.length}));
}

main().catch(error=>{console.error(error instanceof Error?error.message:usage);process.exitCode=1;});
