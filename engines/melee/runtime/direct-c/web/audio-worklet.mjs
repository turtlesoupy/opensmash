import {RingStretcher} from './audio-output.mjs';
class DirectMeleeAudio extends AudioWorkletProcessor {
 constructor(options){super();this.playback=new RingStretcher(options.processorOptions.module,options.processorOptions.ring);this.port.postMessage({type:"ready"});}
 process(inputs,outputs){this.playback.process(outputs[0][0],outputs[0][1]);return true;}
}
registerProcessor('melee-direct-audio',DirectMeleeAudio);
