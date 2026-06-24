/**
 * Алгоритм слогораздела (русский и английский языки)
 */

const RU_VOWELS = 'аеёиоуыэюяАЕЁИОУЫЭЮЯ';
const EN_VOWELS = 'aeiouyAEIOUY';

/**
 * Разбивает слово на слоги на основе гласных звуков и правил переноса
 */
export function splitWordIntoSyllables(word: string): string[] {
  // Очистка знаков препинания
  const cleanWord = word.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '');
  if (cleanWord.length <= 3) return [word];

  const isRussian = /[а-яА-ЯёЁ]/.test(cleanWord);
  const vowels = isRussian ? RU_VOWELS : EN_VOWELS;
  
  const syllables: string[] = [];
  let currentSyllable = '';
  
  for (let i = 0; i < word.length; i++) {
    const char = word[i];
    currentSyllable += char;
    
    const isCurrentVowel = vowels.includes(char);
    
    if (isCurrentVowel) {
      // Проверяем, есть ли дальше в слове еще гласные
      let hasMoreVowels = false;
      for (let j = i + 1; j < word.length; j++) {
        if (vowels.includes(word[j])) {
          hasMoreVowels = true;
          break;
        }
      }
      
      // Если впереди есть еще гласные, делаем слогораздел
      if (hasMoreVowels) {
        // Правила стыка согласных (например, "кар-та", "о-кно")
        let splitOffset = 0;
        const nextChar = word[i + 1];
        const afterNextChar = word[i + 2];
        
        if (nextChar && !vowels.includes(nextChar)) {
          if (afterNextChar && !vowels.includes(afterNextChar)) {
            // Если идут две согласные подряд, делим между ними (например, "кар-та")
            currentSyllable += nextChar;
            splitOffset = 1;
          }
        }
        
        syllables.push(currentSyllable);
        currentSyllable = '';
        i += splitOffset;
      }
    }
  }
  
  if (currentSyllable) {
    if (syllables.length > 0) {
      syllables[syllables.length - 1] += currentSyllable;
    } else {
      syllables.push(currentSyllable);
    }
  }
  
  return syllables;
}
