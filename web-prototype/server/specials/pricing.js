// Standard API rates checked 2026-09-09. Usage includes reasoning output tokens.
// https://developers.openai.com/api/docs/pricing
export function estimateGenerationUsd({model,usage,serviceTier}={}) {
 if(!usage || serviceTier && serviceTier!=='default')return null;
 const rate=model?.startsWith('gpt-5.6-luna')?[.2,.02,.25,1.2]:model?.startsWith('gpt-6-astra')?[10,1,12.5,50]:null;
 if(!rate)return null;
 const detail=usage.input_tokens_details||{},read=detail.cached_tokens||0,write=detail.cache_write_tokens||0;
 if(!Number.isFinite(usage.input_tokens)||!Number.isFinite(usage.output_tokens)||usage.input_tokens<read+write)return null;
 return ((usage.input_tokens-read-write)*rate[0]+read*rate[1]+write*rate[2]+usage.output_tokens*rate[3])/1e6;
}
