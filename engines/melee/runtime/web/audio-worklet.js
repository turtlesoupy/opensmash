class MeleeAudio extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.primed=false;this.started=false;
    this.indices=new Int32Array(options.processorOptions.ring,0,4);
    this.ring=new Float32Array(options.processorOptions.ring,16);
  }
  process(inputs,outputs) {
    const output=outputs[0], capacity=this.ring.length/2;
    let read=Atomics.load(this.indices,1),write=Atomics.load(this.indices,0);
    // Start with a small cushion rather than exposing an empty ring while the
    // first mixer callback is still being scheduled after graphics preparation.
    if(!this.primed) {
      if((write-read+capacity)%capacity<3072){if(this.started)Atomics.add(this.indices,2,output[0].length);return true;}
      this.primed=true;this.started=true;
    }
    for(let i=0;i<output[0].length;i++) {
      if(read===write){Atomics.add(this.indices,2,output[0].length-i);this.primed=false;break;}
      output[0][i]=this.ring[read*2];output[1][i]=this.ring[read*2+1];
      read=(read+1)%capacity;
    }
    Atomics.store(this.indices,1,read);
    Atomics.add(this.indices,3,output[0].length);
    return true;
  }
}
registerProcessor('melee-audio',MeleeAudio);
