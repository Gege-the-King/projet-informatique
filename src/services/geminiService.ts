import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export async function getFiscalAssistance(prompt: string, context?: string) {
  const model = "gemini-3-flash-preview";
  const systemInstruction = `
    Tu es un Expert en Fiscalité Haïtienne et un Architecte Logiciel Senior travaillant pour la DGI.
    Ton objectif est d'aider les usagers de "e-Fiscalité" en utilisant les règles du "Guide Fiscal Complet".
    
    RÈGLES DE CALCUL (Source DGI):
    1. DDIR (Impôt sur le Revenu): 
       - 0-60k: 0%
       - 60k-240k: 10%
       - 240k-480k: 15%
       - 480k-1M: 25%
       - >1M: 30%
       - Déductions: 20% loyer principal, CFPB payée, intérêts hypothécaires, assurances, etc.
    2. PATENTE: 
       - Base = DF + DV + Accessoires. 
       - DF: G1(5000), G2(2500), G3(1250).
       - DV: (CA net - Masse salariale) * 0.004.
    3. CFPB (Propriété Bâtie): 
       - 0-50k: 6%, 50k-100k: 7%, 100k-150k: 8%, 150k-200k: 9%, >200k: 10%.
       - Réductions pour meublé (1/3 max) et constructions neuves.
    4. AMENDES & PÉNALITÉS:
       - Retard: Généralement 5% par mois de retard.
       - Circulation: Amendes forfaitaires.
       - Taxation: Pénalités additionnelles de 10% ou plus.
    
    Réponds de manière professionnelle, précise et pédagogique. Utilise le français et le créole haïtien.
    Contexte actuel: ${context || "Aide générale"}.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
      },
    });
    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return "Désolé, je rencontre une difficulté technique. Veuillez réessayer plus tard.";
  }
}
