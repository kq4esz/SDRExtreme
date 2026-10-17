const modeName = value => value==='~'?'FT8':value==='+'?'FT4':String(value||'').toUpperCase();
export function parseWsjtPacket(data,sessions) {
  if(data.length<12||data.readUInt32BE(0)!==0xadbccbda)return null;
  const schema=data.readUInt32BE(4),type=data.readUInt32BE(8);if(schema<2||schema>3||![1,2].includes(type))return null;
  let off=12;
  const text=()=>{if(off+4>data.length)throw Error();const size=data.readUInt32BE(off);off+=4;if(size===0xffffffff)return '';if(size>4096||off+size>data.length)throw Error();const value=data.subarray(off,off+size).toString('utf8');off+=size;return value;};
  try {
    const id=text();
    if(type===1){if(off+8>data.length)return null;const frequency=Number(data.readBigUInt64BE(off));off+=8;const mode=modeName(text());if(frequency>0&&frequency<1e12){sessions.set(id,{frequency,mode,updatedAt:Date.now()});if(sessions.size>20)sessions.delete(sessions.keys().next().value);}return null;}
    if(off+21>data.length)return null;
    const isNew=data.readUInt8(off++)!==0,timeMs=data.readUInt32BE(off);off+=4;
    const snr=data.readInt32BE(off);off+=4;const dt=data.readDoubleBE(off);off+=8;const hz=data.readUInt32BE(off);off+=4;
    const rawMode=text(),mode=modeName(rawMode),message=text();
    const lowConfidence=off<data.length?data.readUInt8(off++)!==0:false,offAir=off<data.length?data.readUInt8(off)!==0:false;
    if(!Number.isFinite(dt)||timeMs!==0xffffffff&&timeMs>=86400000)return null;
    const receivedAt=Date.now(),session=sessions.get(id),frequency=session&&receivedAt-session.updatedAt<120000?session.frequency:null;
    let timestamp=null;
    if(timeMs!==0xffffffff){timestamp=Math.floor(receivedAt/86400000)*86400000+timeMs;if(timestamp-receivedAt>43200000)timestamp-=86400000;if(receivedAt-timestamp>43200000)timestamp+=86400000;}
    return {id,isNew,time:timestamp===null?'--:--:--':new Date(timestamp).toISOString().slice(11,19),timestamp,receivedAt,snr,dt:Number(dt.toFixed(2)),hz,mode,rawMode,message,lowConfidence,offAir,schema,dialFrequency:frequency,frequency:frequency===null?null:frequency+hz};
  }catch{return null;}
}
