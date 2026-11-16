const fs=require('fs');
function patch(path,reps){let s=fs.readFileSync(path,'utf8');for(const [a,b] of reps){if(!s.includes(a))console.warn('missing',path,a.slice(0,60));s=s.split(a).join(b)}fs.writeFileSync(path,s)}
patch('src/domain/calculations.ts',[
["production: Pick<EggProductionEntry, 'batchId' | 'totalEggs' | 'isVoided'>[];","production: Pick<EggProductionEntry, 'batchId' | 'totalEggs' | 'isVoided' | 'status'>[];"],
["'transactionDate' | 'batchId' | 'intactEggs' | 'crackedEggs' | 'damagedEggs' | 'totalEggs' | 'isVoided'\n  >[];","'transactionDate' | 'batchId' | 'intactEggs' | 'crackedEggs' | 'damagedEggs' | 'totalEggs' | 'isVoided' | 'status'\n  >[];"],
['if (p.isVoided) continue;',"if (p.isVoided || (p.status !== undefined && p.status !== 'APPROVED')) continue;"]
]);
patch('src/components/DashboardView.tsx',[["(p) => !p.isVoided && p.transactionDate >= startDate && p.transactionDate <= endDate","(p) => !p.isVoided && (p.status === undefined || p.status === 'APPROVED') && p.transactionDate >= startDate && p.transactionDate <= endDate"]]);
patch('src/components/BatchesView.tsx',[["if (p.isVoided) continue;","if (p.isVoided || (p.status !== undefined && p.status !== 'APPROVED')) continue;"]]);
patch('src/components/ReportsView.tsx',[["!p.isVoided &&\n        p.transactionDate","!p.isVoided &&\n        (p.status === undefined || p.status === 'APPROVED') &&\n        p.transactionDate"]]);
