const REGIONS =
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );

type ZoneLocale = Intl.Locale & {
  getTimeZones?: () => string[] | undefined;
  getHourCycles?: () => string[] | undefined;
  timeZones?: string[];
  hourCycles?: string[];
};

const cycles = new Map<string, string>();

export function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function zonesOf(region: string): string[] {
  const locale = new Intl.Locale(`und-${region}`) as ZoneLocale;
  return locale.getTimeZones?.() ?? locale.timeZones ?? [];
}

function hourCyclesOf(region: string): string[] {
  const locale = new Intl.Locale(`und-${region}`) as ZoneLocale;
  return locale.getHourCycles?.() ?? locale.hourCycles ?? [];
}

function readHourCycle(zone: string): string {
  const wanted = zone.toLowerCase();
  for (const region of REGIONS) {
    if (!zonesOf(region).some((id) => id.toLowerCase() === wanted)) continue;
    return hourCyclesOf(region)[0] ?? "";
  }
  return "";
}

/** Whether the clock where the reader sits writes midday as 12 PM or as 13:00.
 *  The zone names the place and the place decides: the app's language must not,
 *  or an English reader in Ankara is handed an AM no clock around them shows. */
export function zoneHour12(zone: string = timeZone()): boolean | undefined {
  let cycle = cycles.get(zone);
  if (cycle === undefined) {
    try {
      cycle = readHourCycle(zone);
    } catch {
      cycle = "";
    }
    cycles.set(zone, cycle);
  }
  return cycle ? cycle.startsWith("h1") : undefined;
}
