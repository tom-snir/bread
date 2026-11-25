# Bread

My baking recipes and bake log. Plain HTML, CSS and JavaScript on GitHub Pages, with no build step.

Site: https://tom-snir.github.io/bread/

## How things are stored

### Recipes: `recipes/`

- Each recipe is one plain text file: `recipes/<file-name>.txt`, where the file name is lowercase with dashes, e.g. `overnight-baguettes.txt`.
- The text is kept **exactly** as given. The site reads it like this:
  - first line = title
  - first block after the title (up to the next blank line) = ingredients
  - everything after that = method
- `recipes/list.json` lists every recipe, which the home page and search use:
  ```json
  [
    { "file": "overnight-baguettes", "title": "Overnight Baguettes (4)" }
  ]
  ```

**To add a recipe:** create `recipes/<file-name>.txt` with the exact text, add a line for it to `recipes/list.json` (`title` = the first line of the text), then commit and push.
**To edit a recipe:** overwrite its `.txt` file (and its title in `list.json` if the title changed). Git history keeps old versions.

### Bake log: `bakes/` and `photos/`

- Each recipe's bake log is one Markdown file, `bakes/<file-name>.md`, newest bake first. The site creates it on the first saved bake.
- Each bake is one section. Empty fields are left out:
  ```markdown
  ## 2026-11-25

  **Changes from the recipe:** ...

  **Flour type:** ...

  **Times:** ...

  **Notes:** ...

  ![photo](../photos/overnight-baguettes/2026-11-25-153012-1.jpg)
  ```
- Photos are shrunk in the browser (longest side 1600 px, JPEG) and stored in `photos/<file-name>/<date>-<time>-<n>.jpg`.
- Bakes are saved from the site through the GitHub API, one commit per bake. To edit or delete one, edit the `.md` file (and delete any photos it no longer uses).

## Access token

Saving needs a fine-grained GitHub token limited to this repository, with **Contents: Read and write**. It is entered on the site the first time you save and stored only in that browser's local storage. It is never in this repository.
