# Fork reference bundle

Open [the implementation handoff](reference/catalogue/START_HERE.md) first.

- [Searchable offline browser](reference/catalogue/index.html)
- [Design and behavior guide](reference/catalogue/DESIGN_GUIDE.md)
- [82 feature dossiers](reference/catalogue/FEATURES.md)
- [All147 cases](reference/catalogue/CASES.md)
- [Current gaps](reference/catalogue/GAPS.md)

Extract the entire bundle into a dedicated reference directory. Keep its directory structure so relative links work on Windows and Linux. The browser opens directly from disk. Python3 is optional for command-line lookup and integrity verification:

```sh
python3 tools/query_catalogue.py --feature P0-022
python3 tools/verify_bundle.py .
```

Give the implementation Codex project reference/catalogue/START_HERE.md. It includes a ready-to-use prompt, evidence precedence and implementation workflow. Preserve that project's architecture and independent branding.

This is a private black-box reference, not application source or redistributed product assets. Live fixture repositories, runtimes and account configuration are excluded. Historical setup documents describe the earlier capture phase; they are not new implementation instructions.
