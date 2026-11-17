"""Snake - gioco classico in Python con tkinter (nessuna dipendenza esterna).

Comandi:
    Frecce o WASD  muovi il serpente
    P / Spazio     pausa
    R              ricomincia dopo il game over
    Esc            esci
"""

import random
import tkinter as tk

# --- Impostazioni ---------------------------------------------------------
CELLA = 24            # dimensione di una cella in pixel
COLONNE = 25
RIGHE = 20
VELOCITA_INIZIALE = 140   # millisecondi tra un passo e l'altro
VELOCITA_MINIMA = 60
ACCELERAZIONE = 4         # ms in meno ogni volta che mangi

COLORE_SFONDO = "#1e1e2e"
COLORE_GRIGLIA = "#26263a"
COLORE_TESTA = "#a6e3a1"
COLORE_CORPO = "#74c7a0"
COLORE_CIBO = "#f38ba8"
COLORE_TESTO = "#cdd6f4"

DIREZIONI = {
    "Up": (0, -1), "w": (0, -1), "W": (0, -1),
    "Down": (0, 1), "s": (0, 1), "S": (0, 1),
    "Left": (-1, 0), "a": (-1, 0), "A": (-1, 0),
    "Right": (1, 0), "d": (1, 0), "D": (1, 0),
}


class Partita:
    """Logica del gioco, indipendente dalla grafica."""

    def __init__(self, colonne=COLONNE, righe=RIGHE, rng=None):
        self.colonne = colonne
        self.righe = righe
        self.rng = rng or random.Random()
        self.reset()

    def reset(self):
        cx, cy = self.colonne // 2, self.righe // 2
        self.serpente = [(cx, cy), (cx - 1, cy), (cx - 2, cy)]  # testa per prima
        self.direzione = (1, 0)
        self.prossima_direzione = (1, 0)
        self.punteggio = 0
        self.finita = False
        self.cibo = self._nuovo_cibo()

    def _nuovo_cibo(self):
        libere = [
            (x, y)
            for x in range(self.colonne)
            for y in range(self.righe)
            if (x, y) not in self.serpente
        ]
        return self.rng.choice(libere) if libere else None

    def cambia_direzione(self, nuova):
        # Impedisce di tornare indietro su se stessi
        dx, dy = self.direzione
        if (nuova[0], nuova[1]) != (-dx, -dy):
            self.prossima_direzione = nuova

    def passo(self):
        """Avanza di una cella. Ritorna True se il serpente ha mangiato."""
        if self.finita:
            return False
        self.direzione = self.prossima_direzione
        tx, ty = self.serpente[0]
        nuova_testa = (tx + self.direzione[0], ty + self.direzione[1])

        mangia = nuova_testa == self.cibo
        # La coda si sposta, quindi la cella della coda è libera (se non mangia)
        corpo = self.serpente if mangia else self.serpente[:-1]

        x, y = nuova_testa
        fuori = not (0 <= x < self.colonne and 0 <= y < self.righe)
        if fuori or nuova_testa in corpo:
            self.finita = True
            return False

        self.serpente = [nuova_testa] + corpo
        if mangia:
            self.punteggio += 1
            self.cibo = self._nuovo_cibo()
            if self.cibo is None:  # griglia piena: hai vinto!
                self.finita = True
        return mangia


class GiocoSnake:
    """Finestra tkinter che disegna la partita e gestisce i tasti."""

    def __init__(self, root):
        self.root = root
        self.root.title("Snake")
        self.root.resizable(False, False)

        self.partita = Partita()
        self.record = 0
        self.in_pausa = False
        self.velocita = VELOCITA_INIZIALE
        self.timer = None

        self.etichetta = tk.Label(
            root, font=("Helvetica", 14, "bold"),
            bg=COLORE_SFONDO, fg=COLORE_TESTO, anchor="w", padx=10, pady=6,
        )
        self.etichetta.pack(fill="x")

        self.canvas = tk.Canvas(
            root, width=COLONNE * CELLA, height=RIGHE * CELLA,
            bg=COLORE_SFONDO, highlightthickness=0,
        )
        self.canvas.pack()

        root.configure(bg=COLORE_SFONDO)
        root.bind("<Key>", self.tasto)

        self.ricomincia()

    # --- Controllo --------------------------------------------------------
    def tasto(self, evento):
        k = evento.keysym
        if k == "Escape":
            self.root.destroy()
        elif k in ("p", "P", "space") and not self.partita.finita:
            self.in_pausa = not self.in_pausa
            self.disegna()
        elif k in ("r", "R") and self.partita.finita:
            self.ricomincia()
        elif k in DIREZIONI and not self.in_pausa:
            self.partita.cambia_direzione(DIREZIONI[k])

    def ricomincia(self):
        if self.timer is not None:
            self.root.after_cancel(self.timer)
        self.partita.reset()
        self.in_pausa = False
        self.velocita = VELOCITA_INIZIALE
        self.disegna()
        self.timer = self.root.after(self.velocita, self.ciclo)

    def ciclo(self):
        if not self.in_pausa:
            if self.partita.passo():
                self.velocita = max(VELOCITA_MINIMA, self.velocita - ACCELERAZIONE)
            self.record = max(self.record, self.partita.punteggio)
            self.disegna()
        if self.partita.finita:
            self.timer = None
        else:
            self.timer = self.root.after(self.velocita, self.ciclo)

    # --- Disegno ----------------------------------------------------------
    def cella(self, x, y, colore, margine=1, ovale=False):
        x0, y0 = x * CELLA + margine, y * CELLA + margine
        x1, y1 = (x + 1) * CELLA - margine, (y + 1) * CELLA - margine
        forma = self.canvas.create_oval if ovale else self.canvas.create_rectangle
        forma(x0, y0, x1, y1, fill=colore, outline="")

    def disegna(self):
        c = self.canvas
        c.delete("all")
        p = self.partita

        for x in range(COLONNE):
            for y in range(RIGHE):
                if (x + y) % 2:
                    self.cella(x, y, COLORE_GRIGLIA, margine=0)

        if p.cibo:
            self.cella(*p.cibo, COLORE_CIBO, margine=4, ovale=True)
        for i, (x, y) in enumerate(p.serpente):
            self.cella(x, y, COLORE_TESTA if i == 0 else COLORE_CORPO, margine=2)

        self.etichetta.config(
            text=f"Punteggio: {p.punteggio}      Record: {self.record}"
        )

        centro_x, centro_y = COLONNE * CELLA / 2, RIGHE * CELLA / 2
        if p.finita:
            vinto = p.cibo is None
            titolo = "HAI VINTO!" if vinto else "GAME OVER"
            c.create_text(centro_x, centro_y - 20, text=titolo,
                          fill=COLORE_TESTO, font=("Helvetica", 32, "bold"))
            c.create_text(centro_x, centro_y + 25,
                          text="Premi R per ricominciare, Esc per uscire",
                          fill=COLORE_TESTO, font=("Helvetica", 13))
        elif self.in_pausa:
            c.create_text(centro_x, centro_y, text="PAUSA",
                          fill=COLORE_TESTO, font=("Helvetica", 32, "bold"))


def main():
    root = tk.Tk()
    GiocoSnake(root)
    root.mainloop()


if __name__ == "__main__":
    main()
