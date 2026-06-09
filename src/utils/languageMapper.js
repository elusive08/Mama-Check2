class LanguageMapper {
  constructor() {
    this.languages = {
      en: { name: "English", code: "en", direction: "ltr" },
      pidgin: { name: "Pidgin", code: "pidgin", direction: "ltr" },
      yo: { name: "Yoruba", code: "yo", direction: "ltr" },
      ha: { name: "Hausa", code: "ha", direction: "ltr" },
      ig: { name: "Igbo", code: "ig", direction: "ltr" },
      ar: { name: "Arabic", code: "ar", direction: "rtl" },
    };

    this.symptomTranslations = {
      en: {
        1: "Heavy bleeding",
        2: "Severe headache",
        3: "Swollen face or hand",
        4: "Blurry vision",
        5: "Fever",
        6: "Reduced baby movement",
        7: "Severe abdominal pain",
        8: "Convulsion",
        0: "None - I am fine",
      },
      pidgin: {
        1: "Heavy bleeding",
        2: "Serious headache",
        3: "Swollen face or hand",
        4: "Eye no see well",
        5: "Fever",
        6: "Pikin no dey move well",
        7: "Serious belle pain",
        8: "Fainting/Convulsion",
        0: "No problem - I dey fine",
      },
      yo: {
        1: "Ìṣàn ẹ̀jẹ̀ líle",
        2: "Orí fífọ́ líle",
        3: "Ojú tàbí ọwọ́ wíwú",
        4: "Ojú ṣókùnkùn",
        5: "Iba",
        6: "Ìṣun ọmọ kéré",
        7: "Inú ríro líle",
        8: "Ìpàdánu àìmọ̀kan",
        0: "Kò sí nkankan - ara mi yá",
      },

      ha: {
        1: "Yubura jini da yawa",
        2: "Ciwon kai mai tsanani",
        3: "Kumburin fuska ko hannu",
        4: "Dishewar gani / Gani dishi-dishi",
        5: "Zazzabi",
        6: "Rahuwar motsin jariri",
        7: "Ciwon ciki mai tsanani",
        8: "Fargaba / Shidewa",
        0: "Babu ko daya - Ina lafiya",
      },
      ig: {
        1: "Ọbara ọgbụgba siri ike",
        2: "Isi ọwụwa siri ike",
        3: "Ihu ma ọ bụ aka fụrụ akpụ",
        4: "Ahụghị ụzọ nke ọma / Anya mgbawa",
        5: "Ahụ ọkụ",
        6: "Mbelata mmegharị nwa n'afọ",
        7: "Ihe mgbu siri ike n'afọ",
        8: "Akwụkwọ nkwụ / Ọmụma jijiji ahụ",
        0: "Ọ dịghị nke ọ bụla - Adị m mma",
      },
    };
  }

  getLanguage(code) {
    return this.languages[code] || this.languages.en;
  }

  getLanguageName(code) {
    const lang = this.languages[code];
    return lang ? lang.name : "English";
  }

  getSupportedLanguages() {
    return Object.keys(this.languages);
  }

  translateSymptom(symptomNumber, language) {
    const translations =
      this.symptomTranslations[language] || this.symptomTranslations.en;
    return translations[symptomNumber] || `Symptom ${symptomNumber}`;
  }

  getWelcomeMessage(language, name, clinic) {
    const messages = {
      en: `Welcome to MamaCheck, ${name}! You'll receive weekly pregnancy tips and reminders for your ANC visits at ${clinic}. Reply STOP to opt out. MamaCheck is a safety guide, not a doctor.`,
      pidgin: `Welcome to MamaCheck, ${name}! You go receive tips for pregnancy and reminder for your ANC visit for ${clinic}. Reply STOP if you no want message again. MamaCheck na guide, no be doctor.`,
      yo: `Kaabọ si MamaCheck, ${name}! Iwọ yoo gba awọn imọran oyun ọsẹ ati awọn olurannileti fun awọn ibẹwo ANC rẹ ni ${clinic}. Dahun STOP lati yọọ kuro. MamaCheck jẹ itọsọna aabo, kii ṣe dokita.`,
      ha: `Barka da zuwa MamaCheck, ${name}! Za ku karɓi shawarwari na ciki da kuma tunatarwa don ziyarar ANC ɗinku a ${clinic}. Amsa STOP don fita. MamaCheck jagorar lafiya ne, ba likita ba.`,
      ig: `Nnabata na MamaCheck, ${name}! Ị ga-enweta ndụmọdụ ime ime na ncheta maka ọbịa ANC gị na ${clinic}. Zaa STOP iji pụọ. MamaCheck bụ onye nduzi nchekwa, ọ bụghị dọkịta.`,
    };
    return messages[language] || messages.en;
  }

  getOptOutMessage(language) {
    const messages = {
      en: "Reply STOP to unsubscribe from MamaCheck messages. You will no longer receive reminders or check-ins.",
      pidgin:
        "Reply STOP make we stop to send you message. You no go receive reminder or check-in again.",
      yo: "Dahun STOP lati yọọ kuro ninu awọn ifiranṣẹ MamaCheck. Iwọ kii yoo gba awọn olurannileti tabi awọn ayẹwo mọ.",
      ha: "Amsa STOP don fita daga rasa MamaCheck. Za ku kara shawarwari ko da kuma tunatarwa.",
      ig: "Zaa STOP iji pụọ n'i gbaso MamaCheck. I kii ga-enweta ndụmọdụ ime ime ko da kuma tunatarwa.",
    };
    return messages[language] || messages.en;
  }
}

export default new LanguageMapper();
