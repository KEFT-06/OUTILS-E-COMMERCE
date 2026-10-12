/**
 * Indicatifs téléphoniques par pays (codes ISO 3166-1 alpha-2), d'après le plan de numérotation
 * international de l'UIT. Module pur, partagé avec le site.
 *
 * Les territoires du plan nord-américain partagent le « 1 » : leur préfixe régional fait partie
 * du numéro, on ne le distingue pas ici.
 */
const TABLE =
  // Afrique
  'DZ:213 AO:244 BJ:229 BW:267 BF:226 BI:257 CM:237 CV:238 CF:236 TD:235 KM:269 CG:242 CD:243 CI:225 DJ:253 EG:20 GQ:240 ER:291 SZ:268 ET:251 ' +
  'GA:241 GM:220 GH:233 GN:224 GW:245 KE:254 LS:266 LR:231 LY:218 MG:261 MW:265 ML:223 MR:222 MU:230 YT:262 MA:212 MZ:258 NA:264 NE:227 NG:234 ' +
  'RE:262 RW:250 SH:290 ST:239 SN:221 SC:248 SL:232 SO:252 ZA:27 SS:211 SD:249 TZ:255 TG:228 TN:216 UG:256 EH:212 ZM:260 ZW:263 ' +
  // Europe
  'AL:355 AD:376 AT:43 BY:375 BE:32 BA:387 BG:359 HR:385 CY:357 CZ:420 DK:45 EE:372 FO:298 FI:358 AX:358 FR:33 DE:49 GI:350 GR:30 GG:44 HU:36 ' +
  'IS:354 IE:353 IM:44 IT:39 JE:44 XK:383 LV:371 LI:423 LT:370 LU:352 MT:356 MD:373 MC:377 ME:382 NL:31 MK:389 NO:47 SJ:47 PL:48 PT:351 RO:40 ' +
  'RU:7 SM:378 RS:381 SK:421 SI:386 ES:34 SE:46 CH:41 UA:380 GB:44 VA:39 ' +
  // Amériques
  'US:1 CA:1 MX:52 AR:54 BO:591 BR:55 CL:56 CO:57 CR:506 CU:53 DO:1 EC:593 SV:503 GT:502 HT:509 HN:504 JM:1 NI:505 PA:507 PY:595 PE:51 PR:1 ' +
  'UY:598 VE:58 BZ:501 GY:592 SR:597 GF:594 GP:590 MQ:596 BL:590 MF:590 PM:508 TT:1 BB:1 BS:1 AG:1 DM:1 GD:1 KN:1 LC:1 VC:1 AI:1 BM:1 VG:1 ' +
  'KY:1 MS:1 TC:1 VI:1 AW:297 CW:599 SX:1 BQ:599 GL:299 FK:500 ' +
  // Asie et Moyen-Orient
  'AF:93 AM:374 AZ:994 BH:973 BD:880 BT:975 BN:673 KH:855 CN:86 GE:995 HK:852 IN:91 ID:62 IR:98 IQ:964 IL:972 JP:81 JO:962 KZ:7 KW:965 KG:996 ' +
  'LA:856 LB:961 MO:853 MY:60 MV:960 MN:976 MM:95 NP:977 KP:850 OM:968 PK:92 PS:970 PH:63 QA:974 SA:966 SG:65 KR:82 LK:94 SY:963 TW:886 TJ:992 ' +
  'TH:66 TL:670 TR:90 TM:993 AE:971 UZ:998 VN:84 YE:967 ' +
  // Océanie
  'AU:61 NZ:64 FJ:679 PG:675 NC:687 PF:689 WS:685 TO:676 VU:678 SB:677 KI:686 FM:691 MH:692 PW:680 NR:674 TV:688 CK:682 NU:683 TK:690 WF:681 ' +
  'AS:1 GU:1 MP:1 CX:61 CC:61 NF:672 IO:246';

const DIAL_CODES = new Map<string, string>(TABLE.split(' ').map((entry) => entry.split(':') as [string, string]));

/** L'indicatif du pays, en chiffres ; chaîne vide quand il n'est pas connu. */
export function dialCodeOf(country: string | null | undefined): string {
  return (country && DIAL_CODES.get(country.toUpperCase())) || '';
}
