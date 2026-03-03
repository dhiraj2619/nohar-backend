const Collection = require("../models/collection.model");
const Cloudinary = require("cloudinary");

const createCollection = async (req, res) => {
  try {
    const { name, description, isActive } = req.body;

    if (!name || !description || isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: "Name, description, and isActive are required fields",
      });
    }

    if (!req.files || !req.files.thumbnail) {
      return res.status(400).json({ message: "Please upload thumbnail image" });
    }

    const exisitingCollection = await Collection.findOne({ name });

    if (exisitingCollection) {
      return res.status(400).json({
        success: false,
        message: "Collection with this name already exists",
      });
    }

    const thumbnailResult = await Cloudinary.v2.uploader.upload(
      req.files.thumbnail[0].path,
      {
        folder: "collections",
      },
    );

    const newCollection = await Collection.create({
      name: name.trim(),
      description,
      isActive,
      thumbnail: {
        public_id: thumbnailResult.public_id,
        url: thumbnailResult.secure_url,
      },
    });

    const savedCollection = await newCollection.save();

    return res.status(201).json({
      success: true,
      message: "Collection created successfully",
      data: savedCollection,
    });
  } catch (error) {
    console.error("Error creating collection:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while creating the collection",
      error: error.message,
    });
  }
};

const updateCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, isActive } = req.body;

    if (!name || !description || isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: "Name, description, and isActive are required fields",
      });
    }

    const existingCollection = await Collection.findById(id);

    if (!existingCollection) {
      return res.status(404).json({
        success: false,
        message: "Collection not found",
      });
    }

    const duplicateCollection = await Collection.findOne({
      name: name.trim(),
      _id: { $ne: id },
    });

    if (duplicateCollection) {
      return res.status(400).json({
        success: false,
        message: "Collection with this name already exists",
      });
    }

    let thumbnail = existingCollection.thumbnail;

    if (req.files && req.files.thumbnail) {
      const thumbnailResult = await Cloudinary.v2.uploader.upload(
        req.files.thumbnail[0].path,
        {
          folder: "collections",
        },
      );

      if (existingCollection.thumbnail?.public_id) {
        await Cloudinary.v2.uploader.destroy(
          existingCollection.thumbnail.public_id,
        );
      }

      thumbnail = {
        public_id: thumbnailResult.public_id,
        url: thumbnailResult.secure_url,
      };
    }

    existingCollection.name = name.trim();
    existingCollection.description = description;
    existingCollection.isActive = isActive;
    existingCollection.thumbnail = thumbnail;

    const updatedCollection = await existingCollection.save();

    return res.status(200).json({
      success: true,
      message: "Collection updated successfully",
      data: updatedCollection,
    });
  } catch (error) {
    console.error("Error updating collection:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while updating the collection",
      error: error.message,
    });
  }
};

const deleteCollection = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedCollection = await Collection.findByIdAndDelete(id);

    if (!deletedCollection) {
      return res.status(404).json({
        success: false,
        message: "Collection not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Collection deleted successfully",
      data: deletedCollection,
    });
  } catch (error) {
    console.error("Error deleting collection:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while deleting the collection",
      error: error.message,
    });
  }
};

const getAllCollections = async (req, res) => {
  try {
    const collections = await Collection.find();
    return res.status(200).json({
      success: true,
      message: "Collections retrieved successfully",
      data: collections,
    });
  } catch (error) {
    console.error("Error retrieving collections:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while retrieving collections",
      error: error.message,
    });
  }
};

module.exports = {
  createCollection,
  updateCollection,
  deleteCollection,
  getAllCollections,
};
