// Common USB dial frequencies; frequency allocations and operating practices vary by region.
export const PROPAGATION_BANDS = [
  { name:'160m', low:1800000, high:2000000, ft8:1840000, ft4:null },
  { name:'80m', low:3500000, high:4000000, ft8:3573000, ft4:3575000 },
  { name:'60m', low:5250000, high:5450000, ft8:5357000, ft4:5357000 },
  { name:'40m', low:7000000, high:7300000, ft8:7074000, ft4:7047500 },
  { name:'30m', low:10100000, high:10150000, ft8:10136000, ft4:10140000 },
  { name:'20m', low:14000000, high:14350000, ft8:14074000, ft4:14080000 },
  { name:'17m', low:18068000, high:18168000, ft8:18100000, ft4:18104000 },
  { name:'15m', low:21000000, high:21450000, ft8:21074000, ft4:21140000 },
  { name:'12m', low:24890000, high:24990000, ft8:24915000, ft4:24919000 },
  { name:'10m', low:28000000, high:29700000, ft8:28074000, ft4:28180000 },
  { name:'6m', low:50000000, high:54000000, ft8:50313000, ft4:50318000 }
];
export const bandFor = frequency => PROPAGATION_BANDS.find(band => frequency >= band.low && frequency <= band.high)?.name || 'Other';
export function locatorPoint(value) {
  const grid = String(value || '').toUpperCase();
  if (!/^[A-R]{2}[0-9]{2}(?:[A-X]{2})?(?:[0-9]{2})?$/.test(grid)) return null;
  let longitude = (grid.charCodeAt(0)-65)*20-180+Number(grid[2])*2, latitude = (grid.charCodeAt(1)-65)*10-90+Number(grid[3]);
  let width=2,height=1;
  if(grid.length>=6){width/=24;height/=24;longitude+=(grid.charCodeAt(4)-65)*width;latitude+=(grid.charCodeAt(5)-65)*height;}
  if(grid.length===8){width/=10;height/=10;longitude+=Number(grid[6])*width;latitude+=Number(grid[7])*height;}
  return { latitude:latitude+height/2,longitude:longitude+width/2 };
}
export function maidenhead(latitude, longitude) {
  let x=Math.min(359.999999,Math.max(0,longitude+180)),y=Math.min(179.999999,Math.max(0,latitude+90));
  const field=String.fromCharCode(65+Math.floor(x/20),65+Math.floor(y/10));x%=20;y%=10;
  return field+Math.floor(x/2)+Math.floor(y)+String.fromCharCode(97+Math.floor((x%2)*12),97+Math.floor((y%1)*24));
}
export function distanceKm(a,b){const rad=Math.PI/180,dlat=(b.latitude-a.latitude)*rad,dlon=(b.longitude-a.longitude)*rad;const h=Math.sin(dlat/2)**2+Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin(dlon/2)**2;return 12742*Math.asin(Math.sqrt(Math.min(1,h)));}
