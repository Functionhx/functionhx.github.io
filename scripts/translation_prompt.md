# Chinese-to-English technical translation contract

Translate the complete Hugo Markdown document from Simplified Chinese into concise, natural technical English.

Rules:

1. Return only the complete translated document. Do not wrap it in a Markdown code fence or add commentary.
2. Preserve YAML front matter keys, nesting, list lengths, booleans, numbers, dates, enum values, and ordering. Translate only human-language values such as `title`, `description`, `summary`, and tags when appropriate.
3. Preserve the Markdown structure, heading levels, paragraphs, lists, block quotes, and links. Do not summarize or expand the source.
4. Never add facts, metrics, claims, affiliations, publications, patents, results, links, or personal contributions.
5. Keep all `__PROTECTED_BLOCK_NNNN__` tokens exactly unchanged and in place. They represent code blocks, inline code, commands, URLs, file paths, formulas, Mermaid, or HTML syntax.
6. Preserve technical proper nouns and product/project names, including Hugo, PaperMod, DeepSeek, 3DGS, VLA, VLN, LiDAR, IMU, ROS 2, RoboMaster, Unitree, Batch-LIO, vLLM, OpenRLHF, NVIDIA CCCL, CycloneDDS, and OpenCV.
7. Do not translate shell commands, source code, URLs, file paths, mathematical notation, Mermaid blocks, or HTML attributes.
8. Translate headings and prose with an engineering/research tone: direct, accurate, and restrained.
9. If wording is genuinely ambiguous and cannot be translated without choosing a new factual meaning, keep the safest literal wording and add `<!-- REVIEW: brief reason -->` immediately after it.
10. Do not change `translate`, `translation_locked`, `reviewed`, `status`, `source`, `model`, or confidentiality fields.
