// Only an explicit launch flag enables the demo. Inherited shell state cannot.
function mockMode(argv){return argv.includes('--mock');}
function endpoint(mock,real){return mock && !real ? '/analyze/mock' : '/analyze/real';}
function validateResult(result,mock){
  if(mock)return {...result,mock:true};
  if(!Number.isInteger(result.score) || result.score<0 || result.score>10 ||
     typeof result.category!=='string' || result.contact_guardian!==(result.score>=7) ||
     result.status!==(result.score>=7?'concern_detected':'no_clear_concern'))
    throw new Error('The backend did not return a trained-model score. Quit and restart CareKoala; a mock or outdated response was rejected.');
  return result;
}
module.exports={mockMode,endpoint,validateResult};
