import { parentPort, workerData } from 'node:worker_threads';
import { predictPasses } from './iss-orbit.mjs';
try { const {elements,observer,minElevation,days,now}=workerData;parentPort.postMessage({passes:predictPasses(elements,observer,minElevation,days,now)}); }
catch(error){parentPort.postMessage({error:error.message});}
