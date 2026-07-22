// Dominik's Dashboard — module registry.
// The home grid (index.html) renders FROM THIS ARRAY ONLY:
// adding a module = one new entry here + one new HTML file in /modules.
export const MODULE_REGISTRY = [
  { id:'main',   name:'Main',         emoji:'🎯', sub:"Today's tasks & day progress", href:'modules/main.html',   tint:'51,214,195',  size:'big'  },
  { id:'body',   name:'Body',         emoji:'💪', sub:'Gym & endurance',              href:'modules/body.html',   tint:'96,165,250',  size:'wide' },
  { id:'health', name:'Health',       emoji:'❤️', sub:'Sleep, water, steps & weight', href:'modules/health.html', tint:'52,211,153',  size:'sm'   },
  { id:'habits', name:'Habits',       emoji:'🔁', sub:'Streaks & routines',           href:'modules/habits.html', tint:'255,138,122', size:'sm'   },
  { id:'money',  name:'Money',        emoji:'💰', sub:'Net worth, flow & savings',    href:'modules/money.html',  tint:'245,185,95',  size:'wide' },
  { id:'schedule', name:'Schedule',    emoji:'📅', sub:'Plan your day',                href:'modules/schedule.html', tint:'243,111,79', size:'sm'   },
  { id:'review', name:'Weekly review',emoji:'🤖', sub:'AI coach',                     href:'modules/review.html', tint:'244,114,182', size:'sm'   },
];
