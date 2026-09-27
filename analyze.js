export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({error:"Method not allowed"});
  try {
    const { image } = req.body || {};
    if (!image || !image.startsWith("data:image/")) return res.status(400).json({error:"Mangler bilde"});
    const response = await fetch("https://api.openai.com/v1/responses", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`
      },
      body:JSON.stringify({
        model:"gpt-5",
        input:[{
          role:"user",
          content:[
            {type:"input_text",text:`Identifiser gjenstanden på bildet så presist som mulig. Returner KUN gyldig JSON med feltene: name, description, condition, estimated_value_nok, confidence. estimated_value_nok skal være et forsiktig foreløpig bruktmarkedsestimat i norske kroner basert kun på visuelle kjennetegn; hvis du ikke kan identifisere den pålitelig, bruk null. Ikke lat som du har sett live markedsdata.`},
            {type:"input_image",image_url:image,detail:"high"}
          ]
        }],
        text:{format:{type:"json_object"}}
      })
    });
    const data=await response.json();
    if(!response.ok) return res.status(500).json({error:data.error?.message||"OpenAI-feil"});
    const txt=data.output_text || "";
    const parsed=JSON.parse(txt);
    return res.status(200).json(parsed);
  } catch(e) {
    return res.status(500).json({error:e.message||"Ukjent feil"});
  }
}