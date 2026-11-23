export type UsageRow = {
  org:string; language:string; medianSeconds:number|null; firstReadyUsers:number;
  proposed:number; accepted:number; ready:number; video:number; openVideoWindows:number;
  started:number; finished:number; activeDecks:number; manualRollbacks:number;
};
