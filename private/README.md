# private/

Everything in this folder except this file is ignored by git.

Put your own books, textbooks and course material here, or point the tools at
wherever they already live. Anything extracted from them (word lists, chapter
maps, paragraph exports) is written here too.

```bash
python -m boekenwurm_ingest textbook ~/path/to/your-textbook.pdf      # -> private/textbook/
python -m boekenwurm_ingest paragraphs ~/Books/a-book.epub private/a-book.json
```

Nothing from copyrighted material may be committed, quoted in docs, or used
as a test fixture. Tests build their own synthetic books.
