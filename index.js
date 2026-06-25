const express = require('express');
const cors = require('cors');
const axios = require('axios');
const pool = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

// ============================================
// FUNCIONES AUXILIARES
// ============================================

function validarISBN(isbn) {
    if (!isbn) return true;
    const isbnRegex = /^(?:\d{3}-)?\d{1,5}-\d{1,7}-\d{1,7}-\d{1,7}$/;
    return isbnRegex.test(isbn);
}

async function obtenerNombreAutor(autorId) {
    try {
        const response = await axios.get(`http://localhost:6006/api/autores/${autorId}`);
        return response.data.nombre;
    } catch (err) {
        console.error(`Error al obtener autor ${autorId}:`, err.message);
        return 'Autor no encontrado';
    }
}

async function verificarAutorActivo(autorId) {
    try {
        const response = await axios.get(`http://localhost:6006/api/autores/${autorId}`);
        return response.data.activo !== false;
    } catch (err) {
        console.error(`Error al verificar autor ${autorId}:`, err.message);
        return false;
    }
}

// ============================================
// CRUD DE LIBROS CON SOFT DELETE
// ============================================

// 1. GET - Obtener solo libros activos
app.get('/api/libros', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM libros WHERE activo = true ORDER BY id');
        const libros = resultado.rows;

        const librosConAutor = await Promise.all(
            libros.map(async (libro) => {
                const autorNombre = await obtenerNombreAutor(libro.autor_id);
                const autorActivo = await verificarAutorActivo(libro.autor_id);
                return {
                    ...libro,
                    autor_nombre: autorNombre,
                    autor_activo: autorActivo
                };
            })
        );

        res.json(librosConAutor);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. GET - Obtener TODOS los libros (incluyendo inactivos) - solo para admin
app.get('/api/libros/todos', async (req, res) => {
    try {
        const resultado = await pool.query('SELECT * FROM libros ORDER BY id');
        const libros = resultado.rows;

        const librosConAutor = await Promise.all(
            libros.map(async (libro) => {
                const autorNombre = await obtenerNombreAutor(libro.autor_id);
                const autorActivo = await verificarAutorActivo(libro.autor_id);
                return {
                    ...libro,
                    autor_nombre: autorNombre,
                    autor_activo: autorActivo,
                    activo: libro.activo !== false
                };
            })
        );

        res.json(librosConAutor);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. GET - Obtener un libro por ID
app.get('/api/libros/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query('SELECT * FROM libros WHERE id = $1', [id]);

        if (resultado.rows.length === 0) {
            return res.status(404).json({ error: 'Libro no encontrado' });
        }

        const libro = resultado.rows[0];
        const autorNombre = await obtenerNombreAutor(libro.autor_id);
        const autorActivo = await verificarAutorActivo(libro.autor_id);

        res.json({
            ...libro,
            autor_nombre: autorNombre,
            autor_activo: autorActivo,
            activo: libro.activo !== false
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. POST - Crear un nuevo libro
app.post('/api/libros', async (req, res) => {
    try {
        const { titulo, autor_id, isbn, cantidad_disponible } = req.body;

        if (!titulo || !autor_id) {
            return res.status(400).json({ error: 'Título y autor son requeridos' });
        }

        if (isbn && !validarISBN(isbn)) {
            return res.status(400).json({ error: 'Formato de ISBN inválido. Ejemplo: 978-3-16-148410-0' });
        }

        try {
            const autorResponse = await axios.get(`http://localhost:6006/api/autores/${autor_id}`);
            if (autorResponse.data.activo === false) {
                return res.status(400).json({ error: 'No se puede asignar un libro a un autor inactivo' });
            }
        } catch (err) {
            return res.status(400).json({ error: 'El autor especificado no existe' });
        }

        const nuevo = await pool.query(
            `INSERT INTO libros (titulo, autor_id, isbn, cantidad_disponible, activo) 
             VALUES ($1, $2, $3, $4, true) 
             RETURNING *`,
            [titulo, autor_id, isbn || null, cantidad_disponible || 1]
        );

        const libroCreado = nuevo.rows[0];
        const autorNombre = await obtenerNombreAutor(libroCreado.autor_id);

        res.status(201).json({
            ...libroCreado,
            autor_nombre: autorNombre,
            autor_activo: true,
            activo: true
        });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'El ISBN ya está registrado' });
        }
        res.status(500).json({ error: err.message });
    }
});

// 5. PUT - Actualizar libro completo
app.put('/api/libros/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { titulo, autor_id, isbn, cantidad_disponible } = req.body;

        if (isbn && !validarISBN(isbn)) {
            return res.status(400).json({ error: 'Formato de ISBN inválido. Ejemplo: 978-3-16-148410-0' });
        }

        if (autor_id) {
            try {
                const autorResponse = await axios.get(`http://localhost:6006/api/autores/${autor_id}`);
                if (autorResponse.data.activo === false) {
                    return res.status(400).json({ error: 'No se puede asignar un libro a un autor inactivo' });
                }
            } catch (err) {
                return res.status(400).json({ error: 'El autor especificado no existe' });
            }
        }

        const resultado = await pool.query(
            `UPDATE libros 
             SET titulo = $1, autor_id = $2, isbn = $3, cantidad_disponible = $4
             WHERE id = $5 
             RETURNING *`,
            [titulo, autor_id, isbn, cantidad_disponible, id]
        );

        if (resultado.rows.length === 0) {
            return res.status(404).json({ error: 'Libro no encontrado' });
        }

        const libroActualizado = resultado.rows[0];
        const autorNombre = await obtenerNombreAutor(libroActualizado.autor_id);
        const autorActivo = await verificarAutorActivo(libroActualizado.autor_id);

        res.json({
            ...libroActualizado,
            autor_nombre: autorNombre,
            autor_activo: autorActivo,
            activo: libroActualizado.activo !== false
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. DELETE - Soft Delete (desactivar libro)
app.delete('/api/libros/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query(
            'UPDATE libros SET activo = false WHERE id = $1 RETURNING *',
            [id]
        );
        if (resultado.rows.length === 0) {
            return res.status(404).json({ error: 'Libro no encontrado' });
        }
        res.json({ mensaje: 'Libro desactivado correctamente', libro: resultado.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 7. PUT - Reactivar libro
app.put('/api/libros/:id/reactivar', async (req, res) => {
    try {
        const { id } = req.params;
        const resultado = await pool.query(
            'UPDATE libros SET activo = true WHERE id = $1 RETURNING *',
            [id]
        );
        if (resultado.rows.length === 0) {
            return res.status(404).json({ error: 'Libro no encontrado' });
        }
        res.json({ mensaje: 'Libro reactivado correctamente', libro: resultado.rows[0] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 8. PATCH - Actualizar parcialmente un libro
app.patch('/api/libros/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const campos = req.body;

        if (Object.keys(campos).length === 0) {
            return res.status(400).json({ error: 'No se enviaron campos para actualizar' });
        }

        if (campos.autor_id) {
            try {
                const autorResponse = await axios.get(`http://localhost:6006/api/autores/${campos.autor_id}`);
                if (autorResponse.data.activo === false) {
                    return res.status(400).json({ error: 'No se puede asignar un libro a un autor inactivo' });
                }
            } catch (err) {
                return res.status(400).json({ error: 'El autor especificado no existe' });
            }
        }

        const llaves = Object.keys(campos);
        const valores = Object.values(campos);

        const setQuery = llaves
            .map((llave, index) => `${llave} = $${index + 1}`)
            .join(', ');

        const query = `UPDATE libros SET ${setQuery} WHERE id = $${llaves.length + 1} RETURNING *`;
        const resultado = await pool.query(query, [...valores, id]);

        if (resultado.rows.length === 0) {
            return res.status(404).json({ error: 'Libro no encontrado' });
        }

        const libroActualizado = resultado.rows[0];
        const autorNombre = await obtenerNombreAutor(libroActualizado.autor_id);
        const autorActivo = await verificarAutorActivo(libroActualizado.autor_id);

        res.json({
            mensaje: 'Libro actualizado parcialmente',
            libro: {
                ...libroActualizado,
                autor_nombre: autorNombre,
                autor_activo: autorActivo,
                activo: libroActualizado.activo !== false
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 9. PUT - Desactivar todos los libros de un autor
app.put('/api/libros/desactivar-por-autor/:autorId', async (req, res) => {
    try {
        const { autorId } = req.params;
        const resultado = await pool.query(
            'UPDATE libros SET activo = false WHERE autor_id = $1 AND activo = true RETURNING *',
            [autorId]
        );
        res.json({
            mensaje: `${resultado.rows.length} libros del autor desactivados`,
            libros: resultado.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 6005;
app.listen(PORT, () => {
    console.log(`📚 API Libros escuchando en http://localhost:${PORT}`);
    console.log(`🔗 Integrada con API Autores en http://localhost:6006`);
});
