const express = require('express');
const cors = require('cors');
const axios = require('axios');  // ← PARA CONSULTAR API DE AUTORES
const pool = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

// ============================================
// CRUD DE LIBROS CON INTEGRACIÓN A AUTORES
// ============================================

// Función auxiliar para obtener el nombre de un autor desde la API de autores
async function obtenerNombreAutor(autorId) {
  try {
    const response = await axios.get(`http://localhost:6006/api/autores/${autorId}`);
    return response.data.nombre;
  } catch (err) {
    console.error(`Error al obtener autor ${autorId}:`, err.message);
    return 'Autor no encontrado';
  }
}

// 1. GET - Obtener todos los libros con su autor
app.get('/api/libros', async (req, res) => {
  try {
    // Obtener todos los libros
    const resultado = await pool.query('SELECT * FROM libros ORDER BY id');
    const libros = resultado.rows;
    
    // Para cada libro, obtener el nombre del autor desde la API de autores
    const librosConAutor = await Promise.all(
      libros.map(async (libro) => {
        const autorNombre = await obtenerNombreAutor(libro.autor_id);
        return {
          ...libro,
          autor_nombre: autorNombre
        };
      })
    );
    
    res.json(librosConAutor);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. GET - Obtener un libro por ID con su autor
app.get('/api/libros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await pool.query('SELECT * FROM libros WHERE id = $1', [id]);
    
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Libro no encontrado' });
    }
    
    const libro = resultado.rows[0];
    const autorNombre = await obtenerNombreAutor(libro.autor_id);
    
    res.json({
      ...libro,
      autor_nombre: autorNombre
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. POST - Crear un nuevo libro
app.post('/api/libros', async (req, res) => {
  try {
    const { titulo, autor_id, isbn, cantidad_disponible } = req.body;
    
    if (!titulo || !autor_id) {
      return res.status(400).json({ error: 'Título y autor son requeridos' });
    }
    
    // Verificar que el autor existe en la API de autores
    try {
      await axios.get(`http://localhost:6006/api/autores/${autor_id}`);
    } catch (err) {
      return res.status(400).json({ error: 'El autor especificado no existe' });
    }
    
    const nuevo = await pool.query(
      `INSERT INTO libros (titulo, autor_id, isbn, cantidad_disponible) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [titulo, autor_id, isbn || null, cantidad_disponible || 1]
    );
    
    const libroCreado = nuevo.rows[0];
    const autorNombre = await obtenerNombreAutor(libroCreado.autor_id);
    
    res.status(201).json({
      ...libroCreado,
      autor_nombre: autorNombre
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'El ISBN ya está registrado' });
    }
    res.status(500).json({ error: err.message });
  }
});

// 4. PUT - Actualizar libro completo
app.put('/api/libros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, autor_id, isbn, cantidad_disponible } = req.body;
    
    // Verificar que el autor existe en la API de autores
    if (autor_id) {
      try {
        await axios.get(`http://localhost:6006/api/autores/${autor_id}`);
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
    
    res.json({
      ...libroActualizado,
      autor_nombre: autorNombre
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. DELETE - Eliminar libro
app.delete('/api/libros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await pool.query('DELETE FROM libros WHERE id = $1 RETURNING *', [id]);
    
    if (resultado.rows.length === 0) {
      return res.status(404).json({ error: 'Libro no encontrado' });
    }
    
    res.json({ mensaje: 'Libro eliminado correctamente' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. PATCH - Actualizar parcialmente un libro
app.patch('/api/libros/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const campos = req.body;
    
    if (Object.keys(campos).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos para actualizar' });
    }
    
    // Si se actualiza autor_id, verificar que existe
    if (campos.autor_id) {
      try {
        await axios.get(`http://localhost:6006/api/autores/${campos.autor_id}`);
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
    
    res.json({
      mensaje: 'Libro actualizado parcialmente',
      libro: {
        ...libroActualizado,
        autor_nombre: autorNombre
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// LISTEN
const PORT = process.env.PORT || 6005;
app.listen(PORT, () => {
  console.log(` API Libros escuchando en http://localhost:${PORT}`);
  console.log(` Integrada con API Autores en http://localhost:6006`);
});
