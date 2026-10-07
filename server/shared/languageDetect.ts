/**
 * Reconnaissance de la langue d'un texte — commune au serveur et au navigateur, sans appel
 * extérieur : un guide entier se lit en une fraction de milliseconde.
 *
 * POURQUOI. La langue d'origine d'un guide était celle que l'auteur déclarait dans une liste.
 * Venu pour traduire, il y choisissait « Anglais » — la langue qu'il VOULAIT — et son texte
 * français était enregistré comme anglais : l'anglais lui était alors refusé comme langue de
 * traduction (« Langue du guide »), et la traduction partait d'une langue fausse. Ce n'est pas à
 * l'auteur de dire dans quelle langue il a écrit : le texte le dit.
 *
 * COMMENT. L'écriture d'abord (arabe, cyrillique, chinois…), qui ne trompe pas. Pour l'alphabet
 * latin, les petits mots : « le, les, est, dans » ne se rencontrent pas en anglais, « the, and,
 * with » pas en français. On compte, et on ne conclut que si une langue l'emporte nettement —
 * un texte trop court ou mêlé ne reçoit aucune réponse plutôt qu'une réponse au hasard.
 *
 * Les langues sans liste ici (haoussa, yoruba, wolof…) ne sont jamais devinées : leur déclaration
 * reste celle de l'auteur.
 */

export interface DetectedLanguage {
  code: string;
  /** Part des mots du texte qui sont des petits mots de cette langue (0 à 1) ; 1 pour une écriture propre. */
  share: number;
}

/** Écritures qui désignent une langue à elles seules. */
const SCRIPTS: { code: string; pattern: RegExp }[] = [
  { code: 'ko', pattern: /[가-힯ᄀ-ᇿ]/g },
  { code: 'ja', pattern: /[぀-ヿ]/g },
  { code: 'zh', pattern: /[一-鿿]/g },
  { code: 'hi', pattern: /[ऀ-ॿ]/g },
  { code: 'bn', pattern: /[ঀ-৿]/g },
  { code: 'th', pattern: /[฀-๿]/g },
  { code: 'am', pattern: /[ሀ-፿]/g },
  { code: 'ru', pattern: /[Ѐ-ӿ]/g },
  { code: 'ar', pattern: /[؀-ۿݐ-ݿ]/g },
];

/** Lettres propres à l'ourdou, puis au persan, dans l'écriture arabe. */
const URDU = /[ٹڈڑںھہے]/g;
const PERSIAN = /[پچژگی]/g;

const mots = (liste: string) => new Set(liste.split(' '));

/** Petits mots les plus fréquents de chaque langue à alphabet latin reconnue. */
const SMALL_WORDS: Record<string, Set<string>> = {
  fr: mots('le la les des du un une et est en que qui dans pour pas plus avec sur ce cette ces vous nous ils elle elles sont au aux par ne se sa son ses mais ou comme tout très votre vos leur leurs être avoir fait faire à il je tu on y où dont si sans sous entre chez aussi donc car quand peut cela c qu d l j n s'),
  en: mots('the and of to in is that it for with as on was are be this by from or an have not you your they their will can what which when there has but we our if how a i its these those were been would should about into more than then them so do does did no'),
  es: mots('el la los las de del que y en un una es por con para no se su sus lo como más pero al le este esta estos son muy también cuando donde usted nosotros ser hay porque o a si sin sobre entre ya todo esto eso tiene puede nos mi tu'),
  pt: mots('o a os as de do da dos das que e em um uma é por com para não se seu sua seus mais como mas ao você são também quando onde nos na no nas pelo pela está muito isso este esta tem pode ou já sem sobre entre foi ser há'),
  de: mots('der die das und ist in den von zu mit sich auf für nicht ein eine als auch es an werden aus er hat dass sie nach bei um noch wie einem einen über so zum zur kann wir ihr ich du sind oder wenn nur dem des im was man aber'),
  it: mots('il lo la i gli le di che e è in un una per con non si da del della dei delle come più ma al sono anche questo questa nel nella alla se ci ha tutto o a su tra fra quando dove può essere molto loro noi voi'),
  nl: mots('de het een en van is in dat op te zijn voor met niet aan er om ook als bij maar dan naar deze dit door over uit nog wordt kan je wij ze hij ik u of wat hebben heeft worden zo meer geen tot'),
  id: mots('yang dan di ini itu dengan untuk tidak dari dalam akan pada juga saya ke karena ada atau oleh bisa kita mereka adalah sebagai anda lebih sudah telah harus dapat kami bagi serta hanya jika agar seperti'),
  tr: mots('ve bir bu için ile de da ne gibi daha çok ama olarak en kadar olan var değil ben sen biz mi mı her o şu ya veya ise ki hem sonra önce nasıl neden'),
  vi: mots('và của là có trong được cho không một này với các những để người đã khi tôi bạn chúng họ sẽ đang rất nhiều như cũng nếu vì về từ ra vào thì mà'),
  pl: mots('i w nie na się że to jest do z jak ale o po co tak za od przez dla czy być są ma może tylko już bardzo lub oraz jego jej ich który która które'),
  sw: mots('na ya wa kwa ni katika la za kuwa hii yake kama pia lakini au huu hiyo sana watu kila hilo huo ili bila baada kabla wakati yao wake zake cha vya'),
};

/** En deçà, un texte est trop court pour qu'on se prononce. */
const MIN_WORDS = 30;
/** La langue retenue doit fournir au moins cette part des mots, et devancer nettement la suivante. */
const MIN_SHARE = 0.18;
const MIN_LEAD = 1.35;
/** On ne lit que le début : la langue d'un texte ne change pas à la page 40. */
const SAMPLE_CHARS = 12_000;

/**
 * Langue du texte quand elle se reconnaît sans doute ; `null` sinon — texte trop court, langues
 * mêlées, ou langue que cette reconnaissance ne couvre pas.
 */
export function detectLanguage(raw: string): DetectedLanguage | null {
  const text = raw.slice(0, SAMPLE_CHARS);
  const lettres = (text.match(/\p{L}/gu) ?? []).length;
  if (lettres < 40) return null;

  // Une écriture propre : elle décide dès qu'elle porte l'essentiel du texte.
  for (const { code, pattern } of SCRIPTS) {
    const count = (text.match(pattern) ?? []).length;
    // Le japonais mêle ses syllabaires aux caractères chinois : quelques kana suffisent à le désigner.
    const seuil = code === 'ja' ? 0.08 : 0.4;
    if (count / lettres < seuil) continue;
    if (code === 'ar') {
      const total = Math.max(count, 1);
      if ((text.match(URDU) ?? []).length / total > 0.03) return { code: 'ur', share: 1 };
      if ((text.match(PERSIAN) ?? []).length / total > 0.04) return { code: 'fa', share: 1 };
    }
    return { code, share: 1 };
  }

  const tokens = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (tokens.length < MIN_WORDS) return null;
  const scores = Object.entries(SMALL_WORDS)
    .map(([code, words]) => ({ code, share: tokens.filter((token) => words.has(token)).length / tokens.length }))
    .sort((a, b) => b.share - a.share);
  const [first, second] = scores;
  if (!first || first.share < MIN_SHARE) return null;
  if (second && first.share < second.share * MIN_LEAD) return null;
  return first;
}

/** Langues entre lesquelles une déclaration fausse est corrigée d'office : les confusions réellement observées. */
const HEALABLE = new Set(['fr', 'en', 'es', 'pt', 'de', 'it', 'nl']);

/**
 * La langue déclarée contredit-elle le texte ? Renvoie la langue à retenir à sa place, ou `null`
 * pour garder la déclaration. On ne corrige qu'entre grandes langues latines : un texte en wolof
 * semé de mots français ne doit pas être reclassé « français ».
 */
export function correctedLanguage(declared: string, text: string): string | null {
  if (!HEALABLE.has(declared)) return null;
  const detected = detectLanguage(text);
  if (!detected || detected.code === declared || !HEALABLE.has(detected.code)) return null;
  // Plus sévère que la simple reconnaissance : on défait un choix de l'auteur.
  return detected.share >= 0.24 ? detected.code : null;
}
