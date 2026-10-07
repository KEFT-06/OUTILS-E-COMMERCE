import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { correctedLanguage, detectLanguage } from '@server/shared/languageDetect';

/**
 * Reconnaissance de la langue d'un texte.
 *
 * Le cas qui l'a fait écrire : un ebook français enregistré comme « anglais » parce que l'auteur
 * avait choisi dans la liste la langue qu'il voulait obtenir. L'anglais lui était alors refusé
 * comme langue de traduction.
 */

const FRANCAIS = `Vendre ses beignets devant l'école : ce que personne ne vous dit. Quand j'ai commencé, j'avais 3 500 francs en poche et aucune idée de ce que je faisais. Ce n'est pas la qualité de vos beignets qui décide de vos ventes le premier mois : c'est votre emplacement, votre heure d'arrivée et votre régularité. Ce guide est un ebook pratique sur le marketing et le business des petits commerces, avec un plan simple pour les débutants.`;
const ANGLAIS = `Selling doughnuts outside the school: what nobody tells you. When I started, I had very little money and no idea what I was doing. It is not the quality of your doughnuts that decides your sales in the first month: it is your location, the time you arrive and how regular you are. This guide is a practical ebook for beginners who want to start a small business with a simple plan.`;
const ESPAGNOL = `Vender buñuelos frente a la escuela: lo que nadie te dice. Cuando empecé, tenía muy poco dinero y ninguna idea de lo que hacía. No es la calidad de los buñuelos lo que decide las ventas del primer mes: es el lugar, la hora de llegada y la constancia. Esta guía es para los que quieren empezar un pequeño negocio con un plan sencillo y sin grandes gastos.`;
const PORTUGAIS = `Vender bolinhos em frente à escola: o que ninguém te diz. Quando comecei, tinha muito pouco dinheiro e não fazia ideia do que estava a fazer. Não é a qualidade dos bolinhos que decide as vendas do primeiro mês: é o lugar, a hora de chegada e a regularidade. Este guia é para quem quer começar um pequeno negócio com um plano simples e sem grandes despesas.`;
const ALLEMAND = `Krapfen vor der Schule verkaufen: was dir niemand sagt. Als ich anfing, hatte ich sehr wenig Geld und keine Ahnung, was ich tat. Es ist nicht die Qualität der Krapfen, die über den Verkauf im ersten Monat entscheidet: es ist der Standort, die Uhrzeit und die Regelmäßigkeit. Dieser Leitfaden ist für alle, die mit einem einfachen Plan ein kleines Geschäft beginnen wollen.`;

describe('Reconnaissance de la langue', () => {
  it('reconnaît les grandes langues à alphabet latin, même semées de mots d’emprunt', () => {
    assert.equal(detectLanguage(FRANCAIS)?.code, 'fr', '« ebook », « marketing », « business » ne font pas un texte anglais');
    assert.equal(detectLanguage(ANGLAIS)?.code, 'en');
    assert.equal(detectLanguage(ESPAGNOL)?.code, 'es');
    assert.equal(detectLanguage(PORTUGAIS)?.code, 'pt');
    assert.equal(detectLanguage(ALLEMAND)?.code, 'de');
  });

  it('reconnaît une écriture propre, et distingue l’arabe de l’ourdou et du persan', () => {
    assert.equal(detectLanguage('هذا الدليل موجه إلى كل من يريد أن يبدأ مشروعا صغيرا بخطة بسيطة ومن دون مصاريف كبيرة في السوق المحلي.')?.code, 'ar');
    assert.equal(detectLanguage('یہ رہنما ان لوگوں کے لیے ہے جو ایک سادہ منصوبے کے ساتھ چھوٹا کاروبار شروع کرنا چاہتے ہیں اور زیادہ خرچ نہیں کرنا چاہتے۔')?.code, 'ur');
    assert.equal(detectLanguage('این راهنما برای کسانی است که می‌خواهند با یک برنامهٔ ساده کسب‌وکار کوچکی را شروع کنند و هزینهٔ زیادی نپردازند. چگونه گام به گام پیش برویم.')?.code, 'fa');
    assert.equal(detectLanguage('Это руководство для тех, кто хочет начать небольшое дело с простым планом и без больших расходов на местном рынке.')?.code, 'ru');
    assert.equal(detectLanguage('这本指南是为那些想用一个简单的计划开始小生意的人准备的，不需要很大的开支，也不需要任何经验，只需要每天坚持去做。')?.code, 'zh');
    assert.equal(detectLanguage('このガイドは、シンプルな計画で小さな商売を始めたい人のためのものです。大きな出費も経験も必要ありません。毎日続けることが大切です。')?.code, 'ja');
  });

  it('ne se prononce pas sur un texte trop court, ni sur un mélange', () => {
    assert.equal(detectLanguage('Budget'), null);
    assert.equal(detectLanguage('Élever des poules en ville'), null, 'cinq mots ne suffisent pas');
    const melange = `${ANGLAIS.slice(0, 190)} ${FRANCAIS.slice(0, 190)}`;
    assert.equal(detectLanguage(melange), null, 'moitié anglais, moitié français : aucune réponse plutôt qu’une réponse au hasard');
  });

  it('corrige une langue déclarée que le texte contredit, entre grandes langues seulement', () => {
    assert.equal(correctedLanguage('en', FRANCAIS), 'fr', 'le cas d’origine : un ebook français déclaré « anglais »');
    assert.equal(correctedLanguage('fr', FRANCAIS), null, 'déclaration juste : rien à corriger');
    assert.equal(correctedLanguage('fr', ANGLAIS), 'en');
    assert.equal(correctedLanguage('en', 'Budget'), null, 'texte trop court : la déclaration reste');
    // Un texte déclaré en wolof, semé de français : la déclaration de l'auteur n'est jamais défaite.
    assert.equal(correctedLanguage('wo', FRANCAIS), null);
    assert.equal(correctedLanguage('ar', FRANCAIS), null);
  });
});
