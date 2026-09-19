# External programs the skills need

`rpp lint` needs nothing but Node — it reads your files and reports. **The skills are a different
matter**: they build PDFs, read them back, and run external checkers, so they call programs this
package does not ship.

This page is the prerequisite list and how to satisfy it cheaply. It was moved out of the README
on 2026-09-19: it answers "how do I make the render stage work", which is a question you have
after deciding to use the tool, not before.

## The programs

| program                | comes from                       | which skills call it                     | what happens without it                                            |
| ---------------------- | -------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ |
| `pdflatex`, `bibtex`   | TeX Live                         | render-paper, submit-paper, camera-ready | no PDF is produced — loud                                          |
| `pdfinfo`, `pdftotext` | poppler-utils                    | render-paper, submit-paper               | checks that read the built PDF report that they did not run        |
| `texcount`             | TeX Live (`texlive-extra-utils`) | render-paper, grade-paper-writing        | the length checks cannot run                                       |
| `checkcites`           | TeX Live                         | render-paper                             | nothing asks whether a bibliography entry is uncited               |
| `java`                 | any JRE (21 works)               | render-paper                             | TeXtidote does not run, and **nothing else spell-checks the text** |
| `python3`              | your system                      | the analysis and report scripts          | those scripts do not start                                         |
| `tlmgr`                | TeX Live                         | the TeX installer itself                 | you cannot add a TeX package                                       |

🔴 **Most of these fail QUIETLY**, which is why they are listed rather than left to be discovered.
A missing checker and a passing checker look identical from outside, so every script here states in
its last line which checks actually ran — read that line, not the exit code.

## TeX Live: install it by package name, not by distribution package

The distribution packages are the expensive way. `texlive-fonts-extra` alone is **1691 MB**, and
these papers use **71 MB** of it — apt cannot install less, because Debian does not split those
font families into separate packages.

So install TeX Live directly instead, by name:

```sh
bash node_modules/research-paper-pipeline/skills/render-paper/ci-install-texlive.sh ~/texlive
export PATH="$(find ~/texlive/bin -maxdepth 1 -mindepth 1 -type d | head -1):$PATH"
```

The bin directory is named after the platform, so it is found rather than guessed — the installer
prints the same path on its last line.

**41 named packages**, and the script verifies every file the papers actually load before it
reports success. (The `ci-` in the name is historical — there is nothing CI-specific inside.)

Measured 2026-09-01 and recorded in `skills/render-paper/ensure-toolchain.sh:109`: the apt path
costs **2100 MB** on disk, the `tlmgr` path **230 MB**.

⚠️ The README used to head this section "298 MB, not 2.1 GB". No script in the repository produces
298; the two measurements on record are the 230 MB above and the 482 MB that
`ensure-toolchain.sh:32` reports for its own larger apt-based install. The number was corrected
here rather than carried forward.

An apt list is kept in `skills/render-paper/ensure-toolchain.sh` for machines that cannot reach
CTAN. It works, and it costs the 2100 MB.

## The external checkers

`aclpubcheck` (the official ACL format checker), TeXtidote (spelling) and `rebiber` are not TeX
packages and not npm packages. One idempotent command installs them and then **proves each one
starts**:

```sh
bash node_modules/research-paper-pipeline/skills/render-paper/ensure-checkers.sh
```

```
   ✅ aclpubcheck
   ✅ rebiber
   ✅ jinja2
   ✅ textidote (/opt/textidote/textidote.jar)
✅ all checkers are installed AND run
```

It checks that the tools RUN, not that pip exited zero — `aclpubcheck --help` prints usage and
exits zero on an interpreter where its own dependencies do not import, so "installed" and "works"
are separate questions here.
