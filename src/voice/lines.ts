/**
 * The voice bank: every line a character can say, keyed by the game moment ("cue") that triggers it.
 * Source of truth for TTS generation (scripts/voice) and for subtitles in the client.
 *
 * Tone: adult, brutal, short. Combat barks stay under ~1.5 s so they land inside a bar.
 * Characters are original; nobody imitates a real actor or a copyrighted character.
 */

export type Speaker = 'narrator' | 'verdict' | 'echo' | 'cleaner' | 'butcher' | 'ronin' | 'fox' | 'grunt' | 'chant';

export type VoiceCue =
  // narrator — trailer voice between acts
  | 'narr.episode'
  | 'narr.roof'
  | 'narr.fall'
  | 'narr.train'
  | 'narr.boss'
  | 'narr.victory'
  | 'narr.bloodlust'
  | 'narr.reboot'
  | 'narr.cameo'
  // VERDICT — the boss
  | 'boss.intro'
  | 'boss.miss'
  | 'boss.perfect'
  | 'boss.rage'
  | 'boss.broken'
  | 'boss.exec'
  | 'boss.death'
  | 'boss.whisper'
  | 'boss.laugh'
  | 'boss.roar'
  // ECHO — the cold voice in the hero's head (in-context hints + debrief)
  | 'echo.swipe'
  | 'echo.beat'
  | 'echo.brute'
  | 'echo.dodger'
  | 'echo.feint'
  | 'echo.leaper'
  | 'echo.crawler'
  | 'echo.gunner'
  | 'echo.duel'
  | 'echo.exec'
  | 'echo.lowhp'
  | 'echo.praise'
  | 'echo.combo'
  | 'echo.reboot'
  | 'echo.result.S'
  | 'echo.result.A'
  | 'echo.result.B'
  | 'echo.result.C'
  // cameos
  | 'cleaner.in'
  | 'cleaner.out'
  | 'butcher.in'
  | 'butcher.hit'
  | 'butcher.death'
  | 'ronin.in'
  | 'ronin.out'
  | 'fox.in'
  | 'fox.out'
  // enemies
  | 'grunt.charge'
  | 'grunt.death'
  | 'grunt.pain'
  | 'brute.charge'
  | 'gunner.fire'
  // vocal chops for the music engine
  | 'chant';

export interface VoiceLine {
  id: string;
  speaker: Speaker;
  cue: VoiceCue;
  ru: string;
  en: string;
  /** Extra delivery direction for this line (appended to the speaker's style). */
  style?: string;
  /** Not shown as a subtitle (screams, laughs, chants). */
  noSubtitle?: boolean;
}

export interface SpeakerVoice {
  /** Gemini prebuilt voice name. */
  voice: string;
  /** Delivery direction given to the TTS model (never read aloud). */
  style: string;
  /** Alternate voices for crowd speakers, so ten thugs don't sound like one man. */
  alt?: string[];
}

export const SPEAKERS: Record<Speaker, SpeakerVoice> = {
  narrator: {
    voice: 'Charon',
    style: 'Epic movie-trailer narrator. Extremely low, slow, gravelly bass voice, dramatic pauses, cinematic and ominous',
  },
  verdict: {
    voice: 'Algenib',
    style: 'Demonic executioner from a horror film. Ultra-low, raspy, rumbling bass, slow and menacing, cold contempt',
  },
  echo: {
    voice: 'Kore',
    style: 'Cold, calm, quiet synthetic female voice speaking close to the microphone, almost a whisper, precise and emotionless',
  },
  cleaner: {
    voice: 'Enceladus',
    style: 'Tired professional hitman. Very low, quiet, breathy, calm and deadly, a little ironic',
  },
  butcher: {
    voice: 'Fenrir',
    style: 'Deranged butcher maniac. Hoarse, guttural, screaming, unhinged laughter, spitting the words',
  },
  ronin: {
    voice: 'Alnilam',
    style: 'Old stoic samurai. Very deep, slow, rough voice, calm, heavy with authority',
  },
  fox: {
    voice: 'Pulcherrima',
    style: 'Low, sharp, sly female assassin voice, cold and amused, quick delivery',
  },
  grunt: {
    voice: 'Orus',
    style: 'Aggressive street thug, hoarse shouting, rough and angry, short and loud',
    alt: ['Algieba', 'Sadachbia', 'Zubenelgenubi', 'Rasalgethi'],
  },
  chant: {
    voice: 'Fenrir',
    style: 'Shouted hype chant for a Brazilian phonk track, one punchy word, loud, rhythmic, aggressive',
    alt: ['Puck', 'Sadachbia'],
  },
};

export const LINES: VoiceLine[] = [
  // ---------------------------------------------------------------- narrator
  { id: 'n_episode', speaker: 'narrator', cue: 'narr.episode', ru: 'Эпизод первый. Кровавая луна.', en: 'Episode one. Blood Moon.' },
  { id: 'n_roof', speaker: 'narrator', cue: 'narr.roof', ru: 'Полночь. Крыша. Ни одного свидетеля.', en: 'Midnight. The roof. No witnesses.' },
  { id: 'n_fall', speaker: 'narrator', cue: 'narr.fall', ru: 'Вниз.', en: 'Down.', style: 'One word, heavy, with echo' },
  { id: 'n_train', speaker: 'narrator', cue: 'narr.train', ru: 'Поезд мертвецов. Без остановок.', en: 'The dead men’s train. No stops.' },
  { id: 'n_boss', speaker: 'narrator', cue: 'narr.boss', ru: 'Вердикт. Палач этого города.', en: 'Verdict. This city’s executioner.' },
  { id: 'n_victory', speaker: 'narrator', cue: 'narr.victory', ru: 'Казнь свершилась.', en: 'The execution is done.' },
  { id: 'n_bloodlust', speaker: 'narrator', cue: 'narr.bloodlust', ru: 'Жажда крови.', en: 'Bloodlust.', style: 'Growled, intense' },
  { id: 'n_reboot', speaker: 'narrator', cue: 'narr.reboot', ru: 'Не сегодня.', en: 'Not today.' },
  { id: 'n_cameo', speaker: 'narrator', cue: 'narr.cameo', ru: 'Незваный гость.', en: 'An uninvited guest.' },

  // ---------------------------------------------------------------- VERDICT
  { id: 'v_intro1', speaker: 'verdict', cue: 'boss.intro', ru: 'Я слышу твоё сердце. Оно бьётся не в такт.', en: 'I can hear your heart. It’s off the beat.' },
  { id: 'v_intro2', speaker: 'verdict', cue: 'boss.intro', ru: 'Ещё один герой. Ещё одна голова на мою стену.', en: 'Another hero. Another head for my wall.' },
  { id: 'v_miss1', speaker: 'verdict', cue: 'boss.miss', ru: 'Медленно.', en: 'Slow.' },
  { id: 'v_miss2', speaker: 'verdict', cue: 'boss.miss', ru: 'Ты уже мёртв. Просто ещё не понял.', en: 'You’re already dead. You just don’t know it.' },
  { id: 'v_miss3', speaker: 'verdict', cue: 'boss.miss', ru: 'Кровь. Наконец-то.', en: 'Blood. Finally.' },
  { id: 'v_miss4', speaker: 'verdict', cue: 'boss.miss', ru: 'Твой палец дрожит.', en: 'Your finger is shaking.' },
  { id: 'v_perfect1', speaker: 'verdict', cue: 'boss.perfect', ru: 'Неплохо. Для мяса.', en: 'Not bad. For meat.' },
  { id: 'v_perfect2', speaker: 'verdict', cue: 'boss.perfect', ru: 'Ты читаешь меня. Это ненадолго.', en: 'You read me. It won’t last.' },
  { id: 'v_perfect3', speaker: 'verdict', cue: 'boss.perfect', ru: 'Интересно.', en: 'Interesting.' },
  { id: 'v_rage1', speaker: 'verdict', cue: 'boss.rage', ru: 'Хватит игр!', en: 'Enough games!', style: 'Roaring with fury' },
  { id: 'v_rage2', speaker: 'verdict', cue: 'boss.rage', ru: 'Я разорву тебя под этот бит!', en: 'I’ll tear you apart to this beat!', style: 'Roaring with fury' },
  { id: 'v_broken1', speaker: 'verdict', cue: 'boss.broken', ru: 'Нет. Не может быть.', en: 'No. It can’t be.', style: 'Shocked, out of breath' },
  { id: 'v_broken2', speaker: 'verdict', cue: 'boss.broken', ru: 'Ты ещё пожалеешь.', en: 'You will regret this.', style: 'Wounded, hateful' },
  { id: 'v_exec1', speaker: 'verdict', cue: 'boss.exec', ru: 'Давай. Сделай это красиво.', en: 'Go on. Make it beautiful.' },
  { id: 'v_death', speaker: 'verdict', cue: 'boss.death', ru: 'Луна. Всё. Видела.', en: 'The moon. Saw. Everything.', style: 'Dying, fading, last breath' },
  { id: 'v_whisper1', speaker: 'verdict', cue: 'boss.whisper', ru: 'Я вижу тебя. По ту сторону экрана.', en: 'I see you. On the other side of the screen.', style: 'Whispered, intimate, terrifying' },
  { id: 'v_whisper2', speaker: 'verdict', cue: 'boss.whisper', ru: 'Положи телефон. Пока можешь.', en: 'Put the phone down. While you still can.', style: 'Whispered, intimate, terrifying' },
  { id: 'v_whisper3', speaker: 'verdict', cue: 'boss.whisper', ru: 'Сколько раз ты уже умирал здесь?', en: 'How many times have you died here already?', style: 'Whispered, intimate, terrifying' },
  { id: 'v_laugh', speaker: 'verdict', cue: 'boss.laugh', ru: 'Ха. Ха-ха-ха-ха.', en: '(laughs)', style: 'Slow, deep, evil laughter', noSubtitle: true },
  { id: 'v_roar', speaker: 'verdict', cue: 'boss.roar', ru: 'Р-р-ра-а-а-а!', en: '(roars)', style: 'A monstrous roar of rage', noSubtitle: true },

  // ---------------------------------------------------------------- ECHO
  { id: 'e_swipe', speaker: 'echo', cue: 'echo.swipe', ru: 'Режь в его сторону.', en: 'Cut toward him.' },
  { id: 'e_beat', speaker: 'echo', cue: 'echo.beat', ru: 'Бей в бит. Так больнее.', en: 'Strike on the beat. It hurts more.' },
  { id: 'e_brute', speaker: 'echo', cue: 'echo.brute', ru: 'Броня. Два удара.', en: 'Armor. Two cuts.' },
  { id: 'e_dodger', speaker: 'echo', cue: 'echo.dodger', ru: 'Он сменит сторону.', en: 'He’ll switch sides.' },
  { id: 'e_feint', speaker: 'echo', cue: 'echo.feint', ru: 'Белые глаза — ложь. Жди красных.', en: 'White eyes lie. Wait for red.' },
  { id: 'e_leaper', speaker: 'echo', cue: 'echo.leaper', ru: 'Сверху. Режь вверх.', en: 'Above. Cut up.' },
  { id: 'e_crawler', speaker: 'echo', cue: 'echo.crawler', ru: 'Снизу. Режь вниз.', en: 'Below. Cut down.' },
  { id: 'e_gunner', speaker: 'echo', cue: 'echo.gunner', ru: 'Отбей пулю. В сторону стрелка.', en: 'Deflect the bullet. Toward the shooter.' },
  { id: 'e_duel', speaker: 'echo', cue: 'echo.duel', ru: 'Высокий — вверх. Низкий — вниз. Выпад — к нему.', en: 'High — up. Low — down. Thrust — toward him.' },
  { id: 'e_exec', speaker: 'echo', cue: 'echo.exec', ru: 'Запомни линии. Режь по ним в бит.', en: 'Remember the lines. Cut them on the beat.' },
  { id: 'e_lowhp', speaker: 'echo', cue: 'echo.lowhp', ru: 'Ты истекаешь кровью. Соберись.', en: 'You’re bleeding out. Focus.' },
  { id: 'e_praise1', speaker: 'echo', cue: 'echo.praise', ru: 'Чисто.', en: 'Clean.' },
  { id: 'e_praise2', speaker: 'echo', cue: 'echo.praise', ru: 'Красиво.', en: 'Beautiful.' },
  { id: 'e_combo', speaker: 'echo', cue: 'echo.combo', ru: 'Не останавливайся.', en: 'Don’t stop.' },
  { id: 'e_reboot', speaker: 'echo', cue: 'echo.reboot', ru: 'Сбой. Поднимайся.', en: 'System fault. Get up.' },
  { id: 'e_res_s', speaker: 'echo', cue: 'echo.result.S', ru: 'Безупречно. Город запомнит эту ночь.', en: 'Flawless. The city will remember this night.' },
  { id: 'e_res_a', speaker: 'echo', cue: 'echo.result.A', ru: 'Сильно. Но ты можешь резче.', en: 'Strong. But you can be sharper.' },
  { id: 'e_res_b', speaker: 'echo', cue: 'echo.result.B', ru: 'Ты выжил. Этого мало.', en: 'You survived. That’s not enough.' },
  { id: 'e_res_c', speaker: 'echo', cue: 'echo.result.C', ru: 'Ты видел ритм. Теперь услышь его.', en: 'You saw the rhythm. Now hear it.' },

  // ---------------------------------------------------------------- cameos
  { id: 'c_in1', speaker: 'cleaner', cue: 'cleaner.in', ru: 'Не люблю, когда опаздывают на похороны.', en: 'I hate being late to a funeral.' },
  { id: 'c_in2', speaker: 'cleaner', cue: 'cleaner.in', ru: 'Пригнись, малыш.', en: 'Get down, kid.' },
  { id: 'c_out1', speaker: 'cleaner', cue: 'cleaner.out', ru: 'Дальше сам. Я не работаю бесплатно.', en: 'You’re on your own. I don’t work for free.' },
  { id: 'c_out2', speaker: 'cleaner', cue: 'cleaner.out', ru: 'Чисто.', en: 'Clean.' },
  { id: 'b_in1', speaker: 'butcher', cue: 'butcher.in', ru: 'Свежее мясо! Ха-ха-ха!', en: 'Fresh meat! Ha-ha-ha!' },
  { id: 'b_in2', speaker: 'butcher', cue: 'butcher.in', ru: 'Я сделаю из тебя фарш!', en: 'I’ll grind you into mince!' },
  { id: 'b_hit', speaker: 'butcher', cue: 'butcher.hit', ru: 'А-а-ах! Ещё! Ещё!', en: 'Aaah! More! More!' },
  { id: 'b_death', speaker: 'butcher', cue: 'butcher.death', ru: 'Мясо. Кончилось.', en: 'Out. Of. Meat.', style: 'Gurgling, dying' },
  { id: 'r_in1', speaker: 'ronin', cue: 'ronin.in', ru: 'Луна красная. Значит, кто-то умрёт.', en: 'The moon is red. Someone will die.' },
  { id: 'r_in2', speaker: 'ronin', cue: 'ronin.in', ru: 'Твой клинок поёт. Я подпою.', en: 'Your blade sings. I’ll join in.' },
  { id: 'r_out', speaker: 'ronin', cue: 'ronin.out', ru: 'Мы ещё встретимся. Живыми или нет.', en: 'We’ll meet again. Alive or not.' },
  { id: 'f_in1', speaker: 'fox', cue: 'fox.in', ru: 'Ты шумный. Мне это нравится.', en: 'You’re loud. I like that.' },
  { id: 'f_in2', speaker: 'fox', cue: 'fox.in', ru: 'Левый фланг мой.', en: 'Left flank is mine.' },
  { id: 'f_out', speaker: 'fox', cue: 'fox.out', ru: 'Должок за тобой, Неизвестный.', en: 'You owe me one, Unknown.' },

  // ---------------------------------------------------------------- enemies
  { id: 'g_charge1', speaker: 'grunt', cue: 'grunt.charge', ru: 'Взять его!', en: 'Get him!' },
  { id: 'g_charge2', speaker: 'grunt', cue: 'grunt.charge', ru: 'Сдохни!', en: 'Die!' },
  { id: 'g_charge3', speaker: 'grunt', cue: 'grunt.charge', ru: 'Он один!', en: 'He’s alone!' },
  { id: 'g_charge4', speaker: 'grunt', cue: 'grunt.charge', ru: 'Режь его!', en: 'Cut him!' },
  { id: 'g_death1', speaker: 'grunt', cue: 'grunt.death', ru: 'А-а-а-а!', en: '(screams)', style: 'A short scream of agony', noSubtitle: true },
  { id: 'g_death2', speaker: 'grunt', cue: 'grunt.death', ru: 'Гх-х-х.', en: '(chokes)', style: 'Choking, dying gasp', noSubtitle: true },
  { id: 'g_death3', speaker: 'grunt', cue: 'grunt.death', ru: 'Нет!', en: 'No!', style: 'Terrified last scream', noSubtitle: true },
  { id: 'g_death4', speaker: 'grunt', cue: 'grunt.death', ru: 'Аргх!', en: '(screams)', style: 'Brutal pain scream', noSubtitle: true },
  { id: 'g_pain1', speaker: 'grunt', cue: 'grunt.pain', ru: 'Ох!', en: '(grunts)', style: 'Hit in the gut', noSubtitle: true },
  { id: 'g_pain2', speaker: 'grunt', cue: 'grunt.pain', ru: 'Ах ты!', en: 'Why you!', style: 'Hurt and furious', noSubtitle: true },
  { id: 'br_charge', speaker: 'grunt', cue: 'brute.charge', ru: 'Р-р-раздавлю!', en: 'I’ll crush you!', style: 'Huge brute, growling, very low' },
  { id: 'gu_fire', speaker: 'grunt', cue: 'gunner.fire', ru: 'Огонь!', en: 'Fire!' },

  // ---------------------------------------------------------------- chants (music vocal chops)
  { id: 'ch_hey', speaker: 'chant', cue: 'chant', ru: 'Эй!', en: 'Hey!', noSubtitle: true },
  { id: 'ch_go', speaker: 'chant', cue: 'chant', ru: 'Давай!', en: 'Go!', noSubtitle: true },
  { id: 'ch_ha', speaker: 'chant', cue: 'chant', ru: 'Ха!', en: 'Ha!', noSubtitle: true },
  { id: 'ch_rvi', speaker: 'chant', cue: 'chant', ru: 'Рви!', en: 'Rip!', noSubtitle: true },
  { id: 'ch_vai', speaker: 'chant', cue: 'chant', ru: 'Vai!', en: 'Vai!', style: 'Brazilian Portuguese', noSubtitle: true },
  { id: 'ch_toma', speaker: 'chant', cue: 'chant', ru: 'Toma!', en: 'Toma!', style: 'Brazilian Portuguese', noSubtitle: true },
  { id: 'ch_kill', speaker: 'chant', cue: 'chant', ru: 'Убей!', en: 'Kill!', noSubtitle: true },
  { id: 'ch_blood', speaker: 'chant', cue: 'chant', ru: 'Кровь!', en: 'Blood!', noSubtitle: true },
];

export const LINE_BY_ID: Record<string, VoiceLine> = Object.fromEntries(LINES.map((l) => [l.id, l]));
