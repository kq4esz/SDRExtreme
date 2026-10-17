import { json2satrec, propagate, gstime, eciToGeodetic, eciToEcf, ecfToLookAngles, degreesToRadians, radiansToDegrees } from 'satellite.js';

export function makeOrbit(elements) {
  const epoch = Date.parse(elements?.EPOCH + (/Z$|[+-]\d\d:\d\d$/.test(elements?.EPOCH || '') ? '' : 'Z'));
  if (Number(elements?.NORAD_CAT_ID)!==25544 || !Number.isFinite(epoch) || !(elements.MEAN_MOTION>14 && elements.MEAN_MOTION<17) || !(elements.ECCENTRICITY>=0 && elements.ECCENTRICITY<.1)) throw new Error('Invalid ISS orbital elements.');
  const orbit=json2satrec(elements); if(orbit.error)throw new Error('ISS orbital elements could not be initialized.');
  return {orbit,epoch};
}
export function observerPoint(observer){return observer?{latitude:degreesToRadians(observer.latitude),longitude:degreesToRadians(observer.longitude),height:observer.altitude/1000}:null;}
export function positionAt(orbit,time,observer) {
  const date=new Date(time),result=propagate(orbit,date);
  if(!result?.position || !Number.isFinite(result.position.x))throw new Error('ISS position could not be calculated. Refresh orbital data.');
  const sidereal=gstime(date),geo=eciToGeodetic(result.position,sidereal);
  const point={time,latitude:radiansToDegrees(geo.latitude),longitude:radiansToDegrees(geo.longitude),altitude:geo.height};
  if(observer){const look=ecfToLookAngles(observer,eciToEcf(result.position,sidereal));Object.assign(point,{azimuth:radiansToDegrees(look.azimuth),elevation:radiansToDegrees(look.elevation),rangeKm:look.rangeSat});}
  return point;
}
function crossing(elevation,left,right,level,rising){for(let i=0;i<22;i++){const mid=(left+right)/2;if((elevation(mid)<level)===rising)left=mid;else right=mid;}return Math.round((left+right)/2);}
export function predictPasses(elements,observer,minElevation,days,now) {
  const {orbit}=makeOrbit(elements),point=observerPoint(observer),elevation=time=>positionAt(orbit,time,point).elevation;
  const end=now+days*86400000,step=30000,passes=[];
  let previousTime=now-1200000,previous=elevation(previousTime),rise=previous>0?previousTime:null;
  for(let time=previousTime+step;time<=end+1200000;time+=step){
    const current=elevation(time);
    if(previous<=0&&current>0)rise=crossing(elevation,previousTime,time,0,true);
    if(previous>0&&current<=0&&rise!==null){
      const set=crossing(elevation,previousTime,time,0,false);let left=rise,right=set;
      for(let i=0;i<35;i++){const a=left+(right-left)/3,b=right-(right-left)/3;if(elevation(a)<elevation(b))left=a;else right=b;}
      const peak=Math.round((left+right)/2),maximum=elevation(peak);
      if(maximum>=minElevation){const aos=minElevation===0?rise:crossing(elevation,rise,peak,minElevation,true),los=minElevation===0?set:crossing(elevation,peak,set,minElevation,false);
        if(los>now&&aos<end)passes.push({aos,peak,los,maxElevation:maximum,riseAzimuth:positionAt(orbit,aos,point).azimuth,setAzimuth:positionAt(orbit,los,point).azimuth,durationSeconds:Math.round((los-aos)/1000)});}
      rise=null;
    }
    previous=current;previousTime=time;
  }
  return passes;
}
