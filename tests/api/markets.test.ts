import {expect,it} from 'vitest';
import {parseQuotes,instrument} from '../../src/api/markets';
it('rejects invalid dates and non-observed prices without inventing candles or quotes',()=>{
 const values=Array(50).fill('0');values[3]='1600';values[30]='20260231150000';values[32]='1';
 expect(parseQuotes('v_sh600519="'+values.join('~')+'";',['600519.SH'])).toHaveLength(0);
 values[30]='20261030150000';values[3]='NaN';expect(parseQuotes('v_sh600519="'+values.join('~')+'";',['600519.SH'])).toHaveLength(0);
 expect(()=>instrument('__proto__')).toThrow();
});
